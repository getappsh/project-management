import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { DeploymentReportCacheEntity, ProjectEntity, ReleaseEntity } from '@app/common/database/entities';
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
    params?: GetSystemWideDeploymentReportParams
  ): Promise<SystemWideDeploymentReportDto> {
    this.logger.log('Fetching system-wide deployment report');

    try {
      if (!params?.forceRefresh) {
        const cachedReport = await this.getSystemWideReportFromCache();
        if (cachedReport) {
          this.logger.log('System-wide deployment report retrieved from cache');
          return cachedReport;
        }
      }

      this.logger.log('Generating fresh system-wide deployment report');
      return await this.generateSystemWideDeploymentReport();
    } catch (error) {
      this.logger.error(`Error fetching system-wide deployment report: ${error.message}`);
      throw error;
    }
  }

  async getProjectDeploymentReport(
    projectIdentifier: number | string,
    params?: GetProjectDeploymentReportParams
  ): Promise<ProjectDeploymentReportDto> {
    this.logger.log(`Fetching deployment report for project: ${projectIdentifier}`);

    try {
      const project = await this.getProject(projectIdentifier);
      if (!project) {
        throw new Error(`Project not found: ${projectIdentifier}`);
      }

      if (!params?.forceRefresh) {
        const cachedReport = await this.getProjectReportFromCache(project.id);
        if (cachedReport) {
          this.logger.log(`Project deployment report retrieved from cache for project: ${project.id}`);
          return cachedReport;
        }
      }

      this.logger.log(`Generating fresh deployment report for project: ${project.id}`);
      return await this.generateProjectDeploymentReport(project);
    } catch (error) {
      this.logger.error(`Error fetching deployment report for project ${projectIdentifier}: ${error.message}`);
      throw error;
    }
  }

  async getMultiProjectDeploymentReport(
    projectIdentifiers: (number | string)[],
    params?: GetMultiProjectDeploymentReportParams
  ): Promise<MultiProjectDeploymentReportDto> {
    this.logger.log(`Fetching deployment reports for projects: ${projectIdentifiers.join(', ')}`);

    try {
      const projects = await this.getProjects(projectIdentifiers);
      if (projects.length === 0) {
        throw new Error(`No projects found for identifiers: ${projectIdentifiers.join(', ')}`);
      }

      const projectReports: ProjectDeploymentReportDto[] = [];
      let totalReleases = 0;

      for (const project of projects) {
        try {
          let report: ProjectDeploymentReportDto;

          if (!params?.forceRefresh) {
            const cachedReport = await this.getProjectReportFromCache(project.id);
            if (cachedReport) {
              this.logger.log(`Project report retrieved from cache for project: ${project.id}`);
              report = cachedReport;
            } else {
              report = await this.generateProjectDeploymentReport(project);
            }
          } else {
            report = await this.generateProjectDeploymentReport(project);
          }

          projectReports.push(report);
          totalReleases += report.reports.length;
        } catch (error) {
          this.logger.warn(`Failed to generate report for project ${project.id}: ${error.message}`);
        }
      }

      return {
        projects: projectReports,
        generatedAt: new Date(),
        totalProjects: projectReports.length,
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

  private async generateSystemWideDeploymentReport(): Promise<SystemWideDeploymentReportDto> {
    const allProjects = await this.projectRepo.find();
    const reportsByProject: Record<string, ReleaseReportDto[]> = {};
    const generatedAt = new Date();
    let processedCount = 0;
    let totalReleases = 0;

    for (const project of allProjects) {
      try {
        this.logger.log(`Processing project ${processedCount + 1}/${allProjects.length} (ID: ${project.id})`);
        const projectReport = await this.generateProjectDeploymentReport(project);
        
        // Convert DeploymentReportDto[] to ReleaseReportDto[]
        const releaseReports = projectReport.reports.map(report => this.convertToReleaseReport(report));
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

  private async generateProjectDeploymentReport(project: ProjectEntity): Promise<ProjectDeploymentReportDto> {
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

  private async getSystemWideReportFromCache(): Promise<SystemWideDeploymentReportDto | null> {
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

    const allProjects = await this.projectRepo.find();
    const reportsByProject: Record<string, ReleaseReportDto[]> = {};
    let totalReleases = 0;

    for (const project of allProjects) {
      const cache = allCaches.find(c => c.project.id === project.id);
      if (cache && cache.reportData) {
        const releaseReports = cache.reportData.reports.map(report => this.convertToReleaseReport(report));
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

  private async getProjectReportFromCache(projectId: number): Promise<ProjectDeploymentReportDto | null> {
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

    return cache.reportData as ProjectDeploymentReportDto;
  }

  private async cacheProjectReport(project: ProjectEntity, report: ProjectDeploymentReportDto): Promise<void> {
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

  private convertToReleaseReport(deploymentReport: DeploymentReportDto): ReleaseReportDto {
    return {
      releaseName: deploymentReport.releaseName,
      version: deploymentReport.version,
      downloadedCount: deploymentReport.downloadedCount,
      installedCount: deploymentReport.installedCount,
      activeDeliveryCount: deploymentReport.activeDeliveryCount,
      offeredDevicesCount: deploymentReport.offeredDevicesCount,
      deploymentPercentage: deploymentReport.deploymentPercentage,
    };
  }
}
