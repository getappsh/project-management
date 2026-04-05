import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan, IsNull } from 'typeorm';
import { ProjectEntity, ProjectTokenEntity } from '@app/common/database/entities';
import { 
  GitSyncResultDto, 
  GitSyncStatus, 
  TriggerGitSyncDto, 
  CheckReleaseExistsDto, 
  CheckReleaseExistsResultDto,
  GitSyncCompletedEvent
} from '@app/common/dto/project-management';
import { ImportReleaseDto } from '@app/common/dto/delivery';
import { Inject } from '@nestjs/common';
import { MicroserviceClient, MicroserviceName } from '@app/common/microservice-client';
import { UploadTopics, ProjectManagementTopicsEmit } from '@app/common/microservice-client/topics';
import { lastValueFrom } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
import { ClsService } from 'nestjs-cls';
import { JwtService } from '@nestjs/jwt';

const execAsync = promisify(exec);

@Injectable()
export class GitSyncService {
  private readonly logger = new Logger(GitSyncService.name);
  
  // Track projects currently being synced to prevent duplicate syncs
  private readonly syncInProgress = new Set<number>();

  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ProjectTokenEntity)
    private readonly tokenRepo: Repository<ProjectTokenEntity>,
    @Inject(MicroserviceName.UPLOAD_SERVICE)
    private readonly uploadClient: MicroserviceClient,
    private readonly cls: ClsService,
    private readonly jwtService: JwtService,
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
        const getappConfig = await this.readGetappFile(repoDir, project.gitGetappFilePath);

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
      // Wrap in CLS context if needed for authentication
      return await this.cls.run(async () => {
        const release = await lastValueFrom(
          this.uploadClient.send(UploadTopics.GET_RELEASE_BY_VERSION, {
            projectIdentifier: dto.projectId,
            version: dto.version,
          })
        );

        if (release) {
          return {
            exists: true,
            releaseId: release.id,
          };
        }

        return { exists: false };
      });
    } catch (error) {
      // If not found, return false
      this.logger.debug(`Release ${dto.version} not found for project ${dto.projectId}`);
      return { exists: false };
    }
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

    // Build the effective clone URL (embed HTTPS credentials when provided)
    let effectiveCloneUrl = gitCloneUrl!;
    if (project.gitHttpsUsername && project.gitHttpsPassword) {
      try {
        const parsed = new URL(gitCloneUrl!);
        parsed.username = encodeURIComponent(project.gitHttpsUsername);
        parsed.password = encodeURIComponent(project.gitHttpsPassword);
        effectiveCloneUrl = parsed.toString();
      } catch {
        throw new Error(`Invalid git clone URL: ${gitCloneUrl}`);
      }
    }

    // Build branch flag when a specific branch is configured
    const branchFlag = project.gitBranch ? `--branch "${project.gitBranch}"` : '';

    this.logger.debug(`Cloning repository: ${gitCloneUrl} to ${repoDir}${project.gitBranch ? ` (branch: ${project.gitBranch})` : ''}`);

    try {
      const cmd = `git clone --depth 1 ${branchFlag} "${effectiveCloneUrl}" "${repoDir}"`;
      
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

      // Prevent interactive prompts (important for HTTPS auth failures)
      env.GIT_TERMINAL_PROMPT = '0';

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
   * If project.gitGetappFilePath is set, reads that specific path.
   * Otherwise searches for files with .getapp extension (e.g., .getapp, project.getapp, config.getapp)
   * The file should be JSON format matching ImportReleaseDto structure
   */
  private async readGetappFile(repoDir: string, getappFilePath?: string): Promise<ImportReleaseDto | null> {
    try {
      // If a custom path is configured, use it directly
      if (getappFilePath) {
        const customPath = path.join(repoDir, getappFilePath);
        const fileExists = await fs.promises.access(customPath).then(() => true).catch(() => false);
        if (!fileExists) {
          this.logger.warn(`Configured .getapp file path not found: ${getappFilePath}`);
          return null;
        }
        this.logger.log(`Reading .getapp file from configured path: ${getappFilePath}`);
        const fileContent = await fs.promises.readFile(customPath, 'utf-8');
        const config = JSON.parse(fileContent) as ImportReleaseDto;
        this.validateGetappConfig(config);
        this.logger.log(`Parsed .getapp file with version ${config.version}, ${config.artifacts?.length || 0} artifacts, ${config.dockerImages?.length || 0} docker images`);
        return config;
      }

      // First try the exact .getapp file for backward compatibility
      let getappPath = path.join(repoDir, '.getapp');
      let fileExists = await fs.promises.access(getappPath).then(() => true).catch(() => false);
      
      // If .getapp doesn't exist, search for any file with .getapp extension
      if (!fileExists) {
        this.logger.debug(`File .getapp not found, searching for *.getapp files in ${repoDir}`);
        const files = await fs.promises.readdir(repoDir);
        const getappFiles = files.filter(file => file.endsWith('.getapp'));
        
        if (getappFiles.length === 0) {
          this.logger.warn(`No .getapp files found in repository`);
          return null;
        }
        
        if (getappFiles.length > 1) {
          this.logger.warn(`Multiple .getapp files found: ${getappFiles.join(', ')}. Using first: ${getappFiles[0]}`);
        }
        
        getappPath = path.join(repoDir, getappFiles[0]);
        this.logger.log(`Found .getapp file: ${getappFiles[0]}`);
      }

      const fileContent = await fs.promises.readFile(getappPath, 'utf-8');
      
      // Parse as JSON (ImportReleaseDto structure)
      const config = JSON.parse(fileContent) as ImportReleaseDto;
      this.validateGetappConfig(config);
      
      this.logger.log(`Parsed .getapp file with version ${config.version}, ${config.artifacts?.length || 0} artifacts, ${config.dockerImages?.length || 0} docker images`);
      
      return config;
    } catch (error) {
      this.logger.warn(`Could not read .getapp file: ${error.message}`);
      return null;
    }
  }

  /**
   * Validate .getapp file configuration
   */
  private validateGetappConfig(config: ImportReleaseDto): void {
    if (!config.version) {
      throw new Error('.getapp file must contain a version field');
    }
    if (!config.createdAt) {
      throw new Error('.getapp file must contain a createdAt field');
    }
    if (!config.author) {
      throw new Error('.getapp file must contain an author field');
    }
  }

  /**
   * Trigger release import in upload microservice
   */
  private async triggerReleaseImport(projectId: number, config: ImportReleaseDto): Promise<void> {
    this.logger.log(`Triggering release import for project ${projectId}, version ${config.version}`);

    // Get a valid project token for authentication
    const projectToken = await this.getOrCreateProjectToken(projectId);
    
    // Use config as-is (it's already an ImportReleaseDto), just set auth fields
    const importDto: ImportReleaseDto = {
      ...config,
      // Override/ensure required authentication fields
      project: config.project || projectId.toString(),
      projectIdentifier: projectId,
      // Ensure arrays exist (DTO validation requires them)
      artifacts: config.artifacts || [],
      dockerImages: config.dockerImages || [],
      dependencies: config.dependencies || [],
      // Add git sync metadata if not already present
      metadata: {
        ...config.metadata,
        gitSync: true,
      },
    };

    try {
      // Wrap in CLS context to enable authentication
      await this.cls.run(async () => {
        // Set project token in CLS context for authentication
        this.cls.set('projectToken', projectToken);
        
        await lastValueFrom(
          this.uploadClient.send(UploadTopics.IMPORT_RELEASE, importDto)
        );
      });
    } catch (error) {
      this.logger.error(`Failed to trigger release import: ${error.message}`);
      throw new Error(`Failed to trigger release import: ${error.message}`);
    }
  }

  /**
   * Get or create a project token for system operations
   */
  private async getOrCreateProjectToken(projectId: number): Promise<string> {
    // Get project details for token payload
    const project = await this.projectRepo.findOne({
      where: { id: projectId },
      select: { id: true, name: true },
    });

    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }

    // Look for an existing active token that doesn't expire
    let tokenEntity = await this.tokenRepo.findOne({
      where: {
        project: { id: projectId },
        isActive: true,
        neverExpires: true,
        name: 'git-sync-system',
      },
      order: { createdDate: 'DESC' },
    });

    // If no permanent token exists, create one for git-sync
    if (!tokenEntity) {
      this.logger.log(`Creating git-sync token for project ${projectId}`);
      const jwtToken = this.generateToken(projectId, project.name, 'git-sync-system', true);
      
      const newToken = this.tokenRepo.create({
        project: { id: projectId } as ProjectEntity,
        name: 'git-sync-system',
        token: jwtToken,
        neverExpires: true,
        isActive: true,
      });
      tokenEntity = await this.tokenRepo.save(newToken);
    }

    return tokenEntity.token;
  }

  /**
   * Generate a JWT token for project access
   */
  private generateToken(projectId: number, projectName: string, name: string, neverExpires: boolean, expirationDate?: Date): string {
    this.logger.debug(`Generating JWT token for project ${projectId}`);
    const payload = { projectId, projectName, name, neverExpires };
    const expiresIn = neverExpires
      ? '100y'
      : expirationDate
        ? Math.floor((expirationDate.getTime() - Date.now()) / 1000)
        : '1y';

    return this.jwtService.sign({ data: payload }, { expiresIn });
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
