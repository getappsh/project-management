import { Injectable, Logger } from '@nestjs/common';
import { GitSyncService } from './git-sync.service';
import { ProjectEntity } from '@app/common/database/entities';
import { TimeoutRepeatTask } from '@app/common/safe-cron/timeout-repeated-task.decorator';

@Injectable()
export class GitSyncScheduler {
  private readonly logger = new Logger(GitSyncScheduler.name);

  /** Tracks the last time each project was synced, keyed by project ID */
  private readonly lastSyncedAt = new Map<number, Date>();

  constructor(private readonly gitSyncService: GitSyncService) {}

  /**
   * Run periodic git sync check on startup and repeat every 5 minutes
   * Uses distributed locking to handle multiple project-management instances
   * Note: This works alongside webhooks - projects can have both enabled
   */
  @TimeoutRepeatTask({ 
    name: "periodic-git-sync", 
    initialTimeout: 5000, // Start 5 seconds after microservice starts
    repeatTimeout: 5 * 60 * 1000, // Repeat every 5 minutes
    acquireFailTimeout: 2 * 60 * 1000 // Retry after 2 minutes if lock not acquired
  })
  async handlePeriodicSync() {
    this.logger.debug('Running periodic git sync check...');

    try {
      const projects = await this.gitSyncService.getProjectsForPeriodicSync();
      
      if (projects.length === 0) {
        this.logger.debug('No projects configured for periodic git sync');
        return;
      }

      this.logger.log(`Found ${projects.length} projects for periodic git sync`);

      for (const project of projects) {
        await this.syncProjectIfDue(project);
      }
    } catch (error) {
      this.logger.error('Error in periodic git sync:', error);
    }
  }

  /**
   * Sync a project only if its cloneInterval has elapsed since the last sync.
   * Reads the current interval from the DB-loaded entity, so runtime changes
   * to cloneInterval are picked up on the next scheduler tick.
   */
  private async syncProjectIfDue(project: ProjectEntity) {
    const intervalMs = (project.gitSource!.cloneInterval!) * 60 * 1000;
    const lastSync = this.lastSyncedAt.get(project.id);
    const now = new Date();

    if (lastSync && now.getTime() - lastSync.getTime() < intervalMs) {
      this.logger.debug(
        `Project ${project.id} not due for sync yet ` +
        `(interval: ${project.gitSource!.cloneInterval} min, ` +
        `last sync: ${lastSync.toISOString()})`,
      );
      return;
    }

    try {
      this.logger.log(`Triggering periodic sync for project ${project.id} (${project.name})`);
      // Record sync time before triggering so rapid scheduler ticks don't double-sync
      this.lastSyncedAt.set(project.id, now);

      await this.gitSyncService.syncRepository({
        projectIdentifier: project.id,
        projectId: project.id,
      });
    } catch (error) {
      // Roll back the recorded time so the project is retried on the next tick
      this.lastSyncedAt.delete(project.id);
      this.logger.error(`Error syncing project ${project.id}:`, error);
    }
  }
}
