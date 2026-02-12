import { Injectable, Logger, Inject, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { DeploymentReportCacheEntity, ProjectEntity, ReleaseEntity, MemberProjectEntity } from '@app/common/database/entities';
import {
  DeploymentReportDto,
  ReleaseReportDto,
  SystemWideDeploymentReportDto,
  ProjectDeploymentReportDto,
  MultiProjectDeploymentReportDto,
  GetSystemWideDeploymentReportParams,
  GetProjectDeploymentReportParams,
  GetMultiProjectDeploymentReportParams,
} from '@app/common/dto/upload';
import { MicroserviceClient, MicroserviceName } from '@app/common/microservice-client';
import { UploadTopics } from '@app/common/microservice-client/topics';
import { lastValueFrom } from 'rxjs';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class DeploymentReportCacheService {
  private readonly logger = new Logger(DeploymentReportCacheService.name);
  private readonly CACHE_VALIDITY_HOURS = 24;
  // Delay between processing each project (in ms) to avoid system overload
  // Can be configured via DEPLOYMENT_REPORT_PROCESS_DELAY_MS env variable
  private readonly processDelayMs: number;

  constructor(
    @InjectRepository(DeploymentReportCacheEntity)
    private readonly cacheRepo: Repository<DeploymentReportCacheEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ReleaseEntity)
    private readonly releaseRepo: Repository<ReleaseEntity>,
    @InjectRepository(MemberProjectEntity)
    private readonly memberProjectRepo: Repository<MemberProjectEntity>,
    @Inject(MicroserviceName.UPLOAD_SERVICE) private readonly uploadClient: MicroserviceClient,
    private readonly configService: ConfigService,
  ) {
    this.processDelayMs = parseInt(this.configService.get('DEPLOYMENT_REPORT_PROCESS_DELAY_MS') || '2000', 10);
    this.logger.log(`Deployment report processing delay: ${this.processDelayMs}ms`);
  }

  /**
   * Add delay to prevent system overload when processing multiple projects
   */
  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getSystemWideDeploymentReport(
    userEmail: string,
    params?: GetSystemWideDeploymentReportParams
  ): Promise<SystemWideDeploymentReportDto> {
    this.logger.log(`Fetching system-wide deployment report for user: ${userEmail}`);

    try {
      // Get projects the user has access to
      const userProjectIds = await this.getUserProjectIds(userEmail);
      
      if (!params?.forceRefresh) {
        const cachedReport = await this.getSystemWideReportFromCache(userProjectIds);
        if (cachedReport) {
          this.logger.log('System-wide deployment report retrieved from cache');
          return cachedReport;
        }
      }

      this.logger.log('Generating fresh system-wide deployment report');
      return await this.generateSystemWideDeploymentReport(userProjectIds);
    } catch (error) {
      this.logger.error(`Error fetching system-wide deployment report: ${error.message}`);
      throw error;
    }
  }

  async getProjectDeploymentReport(
    userEmail: string,
    projectIdentifier: number | string,
    params?: GetProjectDeploymentReportParams
  ): Promise<ProjectDeploymentReportDto> {
    this.logger.log(`Fetching deployment report for user: ${userEmail}, project: ${projectIdentifier}`);

    try {
      const project = await this.getProject(projectIdentifier);
      if (!project) {
        throw new Error(`Project not found: ${projectIdentifier}`);
      }

      // Check if user has access to this project
      const hasAccess = await this.userHasAccessToProject(userEmail, project.id);
      if (!hasAccess) {
        throw new UnauthorizedException(`User ${userEmail} does not have access to project ${project.id}`);
      }

      let internalReport: { projectId: number; projectName: string; reports: DeploymentReportDto[]; generatedAt: Date };

      if (!params?.forceRefresh) {
        const cachedReport = await this.getProjectReportFromCache(project.id);
        if (cachedReport) {
          this.logger.log(`Project deployment report retrieved from cache for project: ${project.id}`);
          internalReport = cachedReport;
        } else {
          internalReport = await this.generateProjectDeploymentReport(project);
        }
      } else {
        this.logger.log(`Generating fresh deployment report for project: ${project.id}`);
        internalReport = await this.generateProjectDeploymentReport(project);
      }
      
      // Convert to new structure
      const releaseReports = internalReport.reports.map(report => 
        this.convertToReleaseReport(report, internalReport.projectId, internalReport.projectName)
      );
      return {
        reports: { [project.name]: releaseReports },
        generatedAt: internalReport.generatedAt,
        totalProjects: 1,
        totalReleases: releaseReports.length,
      };
    } catch (error) {
      this.logger.error(`Error fetching deployment report for project ${projectIdentifier}: ${error.message}`);
      throw error;
    }
  }

  async getMultiProjectDeploymentReport(
    userEmail: string,
    projectIdentifiers: (number | string)[],
    params?: GetMultiProjectDeploymentReportParams
  ): Promise<MultiProjectDeploymentReportDto> {
    this.logger.log(`Fetching deployment reports for user: ${userEmail}, projects: ${projectIdentifiers?.join(', ') ?? 'none'}`);

    try {
      // Validation: Check if projectIdentifiers is provided and is not empty
      if (!projectIdentifiers || !Array.isArray(projectIdentifiers) || projectIdentifiers.length === 0) {
        throw new Error('Project identifiers are required and must be a non-empty array');
      }

      const projects = await this.getProjects(projectIdentifiers);
      
      // Validation: Check if any valid projects were found
      if (projects.length === 0) {
        throw new Error(`No valid projects found for identifiers: ${projectIdentifiers.join(', ')}`);
      }

      // Check if user has access to all requested projects
      const userProjectIds = await this.getUserProjectIds(userEmail);
      const unauthorizedProjects = projects.filter(p => !userProjectIds.includes(p.id));
      
      if (unauthorizedProjects.length > 0) {
        const unauthorizedNames = unauthorizedProjects.map(p => p.name).join(', ');
        throw new UnauthorizedException(`User ${userEmail} does not have access to projects: ${unauthorizedNames}`);
      }

      const reportsByProject: Record<string, ReleaseReportDto[]> = {};
      let totalReleases = 0;
      const generatedAt = new Date();

      for (const project of projects) {
        try {
          let internalReport: { projectId: number; projectName: string; reports: DeploymentReportDto[]; generatedAt: Date };

          if (!params?.forceRefresh) {
            const cachedReport = await this.getProjectReportFromCache(project.id);
            if (cachedReport) {
              this.logger.log(`Project report retrieved from cache for project: ${project.id}`);
              internalReport = cachedReport as any;
            } else {
              internalReport = await this.generateProjectDeploymentReport(project);
            }
          } else {
            internalReport = await this.generateProjectDeploymentReport(project);
          }

          const releaseReports = internalReport.reports.map(report => 
            this.convertToReleaseReport(report, internalReport.projectId, internalReport.projectName)
          );
          reportsByProject[project.name] = releaseReports;
          totalReleases += releaseReports.length;
        } catch (error) {
          this.logger.warn(`Failed to generate report for project ${project.id}: ${error.message}`);
        }
      }

      return {
        reports: reportsByProject,
        generatedAt,
        totalProjects: Object.keys(reportsByProject).length,
        totalReleases,
      };
    } catch (error) {
      this.logger.error(`Error fetching multi-project deployment report: ${error.message}`);
      throw error;
    }
  }

  async updateAllProjectReportsCache(): Promise<void> {
    this.logger.log('Starting cache update for all projects');

    try {
      const allProjects = await this.projectRepo.find();
      let successCount = 0;
      let failureCount = 0;
      let processedCount = 0;

      for (const project of allProjects) {
        try {
          this.logger.log(`Updating cache for project ${processedCount + 1}/${allProjects.length} (ID: ${project.id})`);
          await this.generateAndCacheProjectReport(project.id);
          successCount++;
          processedCount++;

          if (processedCount < allProjects.length) {
            this.logger.debug(`Waiting ${this.processDelayMs}ms before processing next project`);
            await this.delay(this.processDelayMs);
          }
        } catch (error) {
          this.logger.warn(`Failed to update cache for project ${project.id}: ${error.message}`);
          failureCount++;
          processedCount++;

          if (processedCount < allProjects.length) {
            await this.delay(this.processDelayMs);
          }
        }
      }

      this.logger.log(
        `Cache update completed. Success: ${successCount}, Failures: ${failureCount}, Total processed: ${processedCount}/${allProjects.length}`
      );
    } catch (error) {
      this.logger.error(`Error updating all project reports cache: ${error.message}`);
      throw error;
    }
  }

  // ============ Private Helper Methods ============

  private async generateSystemWideDeploymentReport(userProjectIds: number[]): Promise<SystemWideDeploymentReportDto> {
    // Filter projects to only those the user has access to
    const allProjects = await this.projectRepo.find({
      where: userProjectIds.length > 0 ? { id: In(userProjectIds) } : {},
    });
    const reportsByProject: Record<string, ReleaseReportDto[]> = {};
    const generatedAt = new Date();
    let processedCount = 0;
    let totalReleases = 0;

    for (const project of allProjects) {
      try {
        this.logger.log(`Processing project ${processedCount + 1}/${allProjects.length} (ID: ${project.id})`);
        const projectReport = await this.generateProjectDeploymentReport(project);
        
        // Convert DeploymentReportDto[] to ReleaseReportDto[]
        const releaseReports = projectReport.reports.map(report => 
          this.convertToReleaseReport(report, projectReport.projectId, projectReport.projectName)
        );
        reportsByProject[project.name] = releaseReports;
        totalReleases += releaseReports.length;
        
        await this.cacheProjectReport(project, projectReport);
        processedCount++;

        if (processedCount < allProjects.length) {
          this.logger.debug(`Waiting ${this.processDelayMs}ms before processing next project`);
          await this.delay(this.processDelayMs);
        }
      } catch (error) {
        this.logger.warn(`Failed to generate reports for project ${project.id}: ${error.message}`);
        processedCount++;

        if (processedCount < allProjects.length) {
          await this.delay(this.processDelayMs);
        }
      }
    }

    this.logger.log(`System-wide report generation completed. Processed ${processedCount}/${allProjects.length} projects`);
    return {
      reports: reportsByProject,
      generatedAt,
      totalProjects: allProjects.length,
      totalReleases,
    };
  }

  private async generateProjectDeploymentReport(project: ProjectEntity): Promise<{ projectId: number; projectName: string; reports: DeploymentReportDto[]; generatedAt: Date }> {
    const releases = await this.releaseRepo.find({
      where: { project: { id: project.id } },
    });

    const reportDtos: DeploymentReportDto[] = [];

    for (const release of releases) {
      try {
        const report = await lastValueFrom(
          this.uploadClient.send(UploadTopics.GET_DEPLOYMENT_REPORT, {
            projectId: project.id,
            projectIdentifier: project.id,
            version: release.version,
            emitPmEvent: false,
            requestSource: 'system-wide',
          })
        ) as DeploymentReportDto;
        reportDtos.push(report);
      } catch (error) {
        this.logger.warn(
          `Failed to generate report for release ${release.version} in project ${project.id}: ${error.message}`
        );
      }
    }

    return {
      projectId: project.id,
      projectName: project.name,
      reports: reportDtos,
      generatedAt: new Date(),
    };
  }

  private async generateAndCacheProjectReport(projectIdentifier: number | string): Promise<void> {
    this.logger.log(`Generating and caching deployment report for project: ${projectIdentifier}`);

    try {
      const project = await this.getProject(projectIdentifier);
      if (!project) {
        throw new Error(`Project not found: ${projectIdentifier}`);
      }

      const report = await this.generateProjectDeploymentReport(project);
      await this.cacheProjectReport(project, report);

      this.logger.log(`Deployment report cached for project: ${project.id}`);
    } catch (error) {
      this.logger.error(`Error generating and caching report for project ${projectIdentifier}: ${error.message}`);
      throw error;
    }
  }

  private async getSystemWideReportFromCache(userProjectIds: number[]): Promise<SystemWideDeploymentReportDto | null> {
    const allCaches = await this.cacheRepo.find({
      relations: { project: true },
      order: { cachedAt: 'DESC' },
    });

    if (allCaches.length === 0) {
      return null;
    }

    const mostRecentCache = allCaches[0];
    if (!this.isCacheValid(mostRecentCache.cachedAt)) {
      this.logger.log('Cache expired, will generate fresh report');
      return null;
    }

    // Filter projects to only those the user has access to
    const allProjects = await this.projectRepo.find({
      where: userProjectIds.length > 0 ? { id: In(userProjectIds) } : {},
    });
    const reportsByProject: Record<string, ReleaseReportDto[]> = {};
    let totalReleases = 0;

    for (const project of allProjects) {
      const cache = allCaches.find(c => c.project.id === project.id);
      if (cache && cache.reportData) {
        const releaseReports = cache.reportData.reports.map(report => 
          this.convertToReleaseReport(report, cache.reportData.projectId, cache.reportData.projectName)
        );
        reportsByProject[project.name] = releaseReports;
        totalReleases += releaseReports.length;
      }
    }

    return {
      reports: reportsByProject,
      generatedAt: mostRecentCache.cachedAt,
      totalProjects: allProjects.length,
      totalReleases,
    };
  }

  private async getProjectReportFromCache(projectId: number): Promise<any | null> {
    const cache = await this.cacheRepo.findOne({
      where: { project: { id: projectId } },
      relations: { project: true },
      order: { cachedAt: 'DESC' },
    });

    if (!cache) {
      return null;
    }

    if (!this.isCacheValid(cache.cachedAt)) {
      this.logger.log(`Cache expired for project ${projectId}, will generate fresh report`);
      return null;
    }

    // Return the internal format with projectId, projectName, and reports array
    return cache.reportData as { projectId: number; projectName: string; reports: DeploymentReportDto[]; generatedAt: Date };
  }

  private async cacheProjectReport(project: ProjectEntity, report: { projectId: number; projectName: string; reports: DeploymentReportDto[]; generatedAt: Date }): Promise<void> {
    let cache = await this.cacheRepo.findOneBy({ project: { id: project.id } });

    if (!cache) {
      cache = this.cacheRepo.create({
        project,
        reportData: report,
        cachedAt: new Date(),
      });
    } else {
      cache.reportData = report;
      cache.cachedAt = new Date();
    }

    await this.cacheRepo.save(cache);
  }

  private isCacheValid(cachedAt: Date): boolean {
    const now = new Date();
    const cacheAgeHours = (now.getTime() - cachedAt.getTime()) / (1000 * 60 * 60);
    return cacheAgeHours < this.CACHE_VALIDITY_HOURS;
  }

  private async getProject(identifier: number | string): Promise<ProjectEntity | null> {
    if (typeof identifier === 'number') {
      return this.projectRepo.findOneBy({ id: identifier });
    } else {
      return this.projectRepo.findOneBy({ name: identifier });
    }
  }

  private async getProjects(identifiers: (number | string)[]): Promise<ProjectEntity[]> {
    const numberIds = identifiers.filter(id => typeof id === 'number');
    const stringNames = identifiers.filter(id => typeof id === 'string');

    const queries: Promise<ProjectEntity[]>[] = [];

    if (numberIds.length > 0) {
      queries.push(this.projectRepo.findBy({ id: In(numberIds as number[]) }));
    }

    if (stringNames.length > 0) {
      queries.push(this.projectRepo.findBy({ name: In(stringNames as string[]) }));
    }

    const results = await Promise.all(queries);
    const projects = results.flat();

    return Array.from(new Map(projects.map(p => [p.id, p])).values());
  }

  private convertToReleaseReport(deploymentReport: DeploymentReportDto, projectId: number, projectName: string): ReleaseReportDto {
    return {
      projectId,
      projectName,
      releaseName: deploymentReport.releaseName,
      version: deploymentReport.version,
      downloadedCount: deploymentReport.downloadedCount,
      installedCount: deploymentReport.installedCount,
      activeDeliveryCount: deploymentReport.activeDeliveryCount,
      offeredDevicesCount: deploymentReport.offeredDevicesCount,
      deploymentPercentage: deploymentReport.deploymentPercentage,
    };
  }

  /**
   * Get list of project IDs that the user has access to
   */
  private async getUserProjectIds(userEmail: string): Promise<number[]> {
    const memberProjects = await this.memberProjectRepo.find({
      where: {
        member: { email: userEmail },
      },
      relations: ['project'],
    });

    return memberProjects.map(mp => mp.project.id);
  }

  /**
   * Check if user has access to a specific project
   */
  private async userHasAccessToProject(userEmail: string, projectId: number): Promise<boolean> {
    const memberProject = await this.memberProjectRepo.findOne({
      where: {
        member: { email: userEmail },
        project: { id: projectId },
      },
    });

    return !!memberProject;
  }
}
