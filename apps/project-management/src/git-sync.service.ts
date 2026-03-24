import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, IsNull } from 'typeorm';
import { ProjectEntity } from '@app/common/database/entities';
import { 
  GitSyncResultDto, 
  GitSyncStatus, 
  TriggerGitSyncDto, 
  CheckReleaseExistsDto, 
  CheckReleaseExistsResultDto,
  GitSyncCompletedEvent,
  GetappFileConfig 
} from '@app/common/dto/project-management';
import { Inject } from '@nestjs/common';
import { MicroserviceClient, MicroserviceName } from '@app/common/microservice-client';
import { UploadTopics, ProjectManagementTopicsEmit } from '@app/common/microservice-client/topics';
import { lastValueFrom } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

@Injectable()
export class GitSyncService {
  private readonly logger = new Logger(GitSyncService.name);
  
  // Track projects currently being synced to prevent duplicate syncs
  private readonly syncInProgress = new Set<number>();

  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @Inject(MicroserviceName.UPLOAD_SERVICE)
    private readonly uploadClient: MicroserviceClient,
  ) {}

  /**
   * Trigger a git sync operation for a project
   * Returns early if sync is already in progress for this project
   */
  async syncRepository(dto: TriggerGitSyncDto): Promise<GitSyncResultDto> {
    const project = await this.projectRepo.findOne({
      where: this.findProjectCondition(dto.projectIdentifier),
    });

    if (!project) {
      throw new NotFoundException(`Project not found: ${dto.projectIdentifier}`);
    }

    if (!project.gitCloneUrl) {
      throw new BadRequestException('Git clone URL not configured for this project');
    }

    // Check if sync is already in progress
    if (this.syncInProgress.has(project.id)) {
      this.logger.log(`Sync already in progress for project ${project.id}, skipping duplicate request`);
      return {
        projectId: project.id,
        status: GitSyncStatus.IN_PROGRESS,
        message: 'Sync already in progress for this project',
      };
    }

    // Mark sync as in progress
    this.syncInProgress.add(project.id);

    this.logger.log(`Starting git sync for project ${project.id}: ${project.name}`);

    const result: GitSyncResultDto = {
      projectId: project.id,
      status: GitSyncStatus.IN_PROGRESS,
    };

    try {
      // Create temporary directory for cloning
      const tempBaseDir = await this.createTempDirectory(project.id);
      const repoDir = path.join(tempBaseDir, 'repo');
      const sshDir = path.join(tempBaseDir, 'ssh');

      try {
        // Clone the repository
        await this.cloneRepository(project, repoDir, sshDir);

        // Read .getapp file
        const getappConfig = await this.readGetappFile(repoDir);

        if (!getappConfig) {
          result.status = GitSyncStatus.FAILED;
          result.error = '.getapp file not found in repository';
          this.emitSyncCompletedEvent(result);
          return result;
        }

        result.version = getappConfig.version;

        // Check if release already exists
        const releaseExists = await this.checkReleaseExists({
          projectId: project.id,
          version: getappConfig.version,
        });

        if (releaseExists.exists) {
          result.status = GitSyncStatus.SUCCESS;
          result.message = `Release ${getappConfig.version} already exists`;
          result.releaseCreated = false;
          this.logger.log(`Release ${getappConfig.version} already exists for project ${project.id}`);
          this.emitSyncCompletedEvent(result);
          return result;
        }

        // Trigger import release process
        await this.triggerReleaseImport(project.id, getappConfig);

        result.status = GitSyncStatus.SUCCESS;
        result.message = `Successfully initiated import for version ${getappConfig.version}`;
        result.releaseCreated = true;

        this.logger.log(`Successfully synced project ${project.id}, version ${getappConfig.version}`);
        this.emitSyncCompletedEvent(result);

        return result;
      } finally {
        // Clean up temporary directory (includes SSH keys and cloned repo)
        await this.cleanupTempDirectory(tempBaseDir);
      }
    } catch (error) {
      this.logger.error(`Error syncing repository for project ${project.id}:`, error);
      result.status = GitSyncStatus.FAILED;
      result.error = error.message;
      this.emitSyncCompletedEvent(result);
      return result;
    } finally {
      // Always remove from in-progress set when sync completes (success or failure)
      this.syncInProgress.delete(project.id);
      this.logger.debug(`Removed project ${project.id} from sync in-progress tracker`);
    }
  }

  /**
   * Check if a release exists for a project
   */
  async checkReleaseExists(dto: CheckReleaseExistsDto): Promise<CheckReleaseExistsResultDto> {
    try {
      const release = await lastValueFrom(
        this.uploadClient.send(UploadTopics.GET_RELEASE_BY_VERSION, {
          projectId: dto.projectId,
          version: dto.version,
        })
      );

      if (release) {
        return {
          exists: true,
          releaseId: release.id,
        };
      }
    } catch (error) {
      // If not found, return false
      this.logger.debug(`Release ${dto.version} not found for project ${dto.projectId}`);
    }

    return { exists: false };
  }

  /**
   * Get all projects that need periodic syncing
   * Returns projects with gitCloneInterval configured (regardless of webhook presence)
   */
  async getProjectsForPeriodicSync(): Promise<ProjectEntity[]> {
    const projects = await this.projectRepo.find({
      where: {
        gitCloneInterval: MoreThan(0),
      },
    });

    // Filter out projects without git configuration and those currently syncing
    return projects.filter(p => 
      p.gitCloneUrl && 
      p.gitCloneInterval && 
      p.gitCloneInterval > 0 &&
      !this.syncInProgress.has(p.id) // Don't return projects that are currently syncing
    );
  }

  /**
   * Clone a git repository
   * @param project - Project entity with git configuration
   * @param repoDir - Directory where repository will be cloned
   * @param sshDir - Isolated directory for SSH keys (completely separate from host ~/.ssh)
   */
  private async cloneRepository(project: ProjectEntity, repoDir: string, sshDir: string): Promise<void> {
    const gitCloneUrl = project.gitCloneUrl;
    
    // Create repo directory
    await fs.promises.mkdir(repoDir, { recursive: true });

    // If SSH key is provided, set up SSH authentication in isolated directory
    let sshKeyPath: string | undefined;
    if (project.gitSshKey) {
      sshKeyPath = await this.setupSshKey(project.gitSshKey, sshDir);
    }

    this.logger.debug(`Cloning repository: ${gitCloneUrl} to ${repoDir}`);

    try {
      const cmd = `git clone --depth 1 "${gitCloneUrl}" "${repoDir}"`;
      
      // Build environment with isolated SSH configuration
      const env: NodeJS.ProcessEnv = { ...process.env };
      
      if (sshKeyPath) {
        // Use GIT_SSH_COMMAND to specify:
        // - Custom SSH key location (isolated from host ~/.ssh)
        // - Disable strict host key checking (for automation)
        // - Use isolated known_hosts file
        const knownHostsPath = path.join(sshDir, 'known_hosts');
        env.GIT_SSH_COMMAND = `ssh -i "${sshKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile="${knownHostsPath}"`;
        
        // Ensure HOME doesn't interfere with SSH config
        env.HOME = sshDir;
      }

      const { stdout, stderr } = await execAsync(cmd, { env });

      this.logger.debug(`Git clone output: ${stdout}`);
      if (stderr) {
        this.logger.debug(`Git clone stderr: ${stderr}`);
      }
    } catch (error) {
      this.logger.error(`Failed to clone repository: ${error.message}`);
      throw new Error(`Failed to clone repository: ${error.message}`);
    }
  }

  /**
   * Set up SSH key for git operations in an isolated directory
   * This ensures the host machine's ~/.ssh is never touched or affected
   * @param sshKey - Base64 encoded SSH private key
   * @param sshDir - Isolated directory for SSH configuration (not host ~/.ssh)
   * @returns Path to the SSH key file
   */
  private async setupSshKey(sshKey: string, sshDir: string): Promise<string> {
    // Create isolated SSH directory with proper permissions
    await fs.promises.mkdir(sshDir, { recursive: true, mode: 0o700 });

    const keyPath = path.join(sshDir, 'id_rsa');
    const knownHostsPath = path.join(sshDir, 'known_hosts');

    // Decode and write SSH private key with secure permissions
    const decodedKey = Buffer.from(sshKey, 'base64').toString('utf-8');
    await fs.promises.writeFile(keyPath, decodedKey, { mode: 0o600 });

    // Create empty known_hosts file (will be populated during clone)
    await fs.promises.writeFile(knownHostsPath, '', { mode: 0o600 });

    this.logger.debug(`SSH key setup complete in isolated directory: ${sshDir}`);
    
    return keyPath;
  }

  /**
   * Read and parse .getapp file from repository
   */
  private async readGetappFile(repoDir: string): Promise<GetappFileConfig | null> {
    const getappPath = path.join(repoDir, '.getapp');

    try {
      const fileContent = await fs.promises.readFile(getappPath, 'utf-8');
      
      // Try parsing as JSON first, then YAML-like structure
      try {
        const config = JSON.parse(fileContent) as GetappFileConfig;
        this.validateGetappConfig(config);
        return config;
      } catch (jsonError) {
        // Simple YAML-like parsing for key:value format
        const config: GetappFileConfig = { version: '' };
        const lines = fileContent.split('\n');
        for (const line of lines) {
          const match = line.match(/^(\w+):\s*(.+)$/);
          if (match) {
            const [, key, value] = match;
            config[key] = value.trim();
          }
        }
        this.validateGetappConfig(config);
        return config;
      }
    } catch (error) {
      this.logger.warn(`Could not read .getapp file: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate .getapp file configuration
   */
  private validateGetappConfig(config: GetappFileConfig): void {
    if (!config.version) {
      throw new Error('.getapp file must contain a version field');
    }
  }

  /**
   * Trigger release import in upload microservice
   */
  private async triggerReleaseImport(projectId: number, config: GetappFileConfig): Promise<void> {
    this.logger.log(`Triggering release import for project ${projectId}, version ${config.version}`);

    const importDto = {
      projectId,
      version: config.version,
      name: config.name,
      description: config.description,
      downloadUrl: config.downloadUrl,
      platforms: config.platforms,
      dependencies: config.dependencies,
      // Mark as imported from git
      isImported: true,
    };

    try {
      await lastValueFrom(
        this.uploadClient.send(UploadTopics.IMPORT_RELEASE, importDto)
      );
    } catch (error) {
      this.logger.error(`Failed to trigger release import: ${error.message}`);
      throw new Error(`Failed to trigger release import: ${error.message}`);
    }
  }

  /**
   * Create temporary directory for git operations
   */
  private async createTempDirectory(projectId: number): Promise<string> {
    const tempDir = path.join(os.tmpdir(), `getapp-git-sync-${projectId}-${Date.now()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  /**
   * Clean up temporary directory
   */
  private async cleanupTempDirectory(dir: string): Promise<void> {
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      this.logger.debug(`Cleaned up temporary directory: ${dir}`);
    } catch (error) {
      this.logger.warn(`Failed to clean up directory ${dir}: ${error.message}`);
    }
  }

  /**
   * Emit git sync completed event
   */
  private emitSyncCompletedEvent(result: GitSyncResultDto): void {
    const event: GitSyncCompletedEvent = {
      projectId: result.projectId,
      status: result.status,
      version: result.version,
      error: result.error,
      timestamp: new Date(),
    };

    // Emit via microservice client
    this.uploadClient.emit(ProjectManagementTopicsEmit.GIT_SYNC_COMPLETED, event);
  }

  /**
   * Helper to find project by identifier
   */
  private findProjectCondition(projectIdentifier: number | string) {
    return typeof projectIdentifier === 'number'
      ? { id: projectIdentifier }
      : { name: projectIdentifier };
  }
}
