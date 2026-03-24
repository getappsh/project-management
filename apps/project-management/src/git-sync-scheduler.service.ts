import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GitSyncService } from './git-sync.service';
import { ProjectEntity } from '@app/common/database/entities';

@Injectable()
export class GitSyncScheduler {
  private readonly logger = new Logger(GitSyncScheduler.name);

  constructor(private readonly gitSyncService: GitSyncService) {}

  /**
   * Run every 5 minutes to check for projects that need periodic syncing
   * Note: This works alongside webhooks - projects can have both enabled
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
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
   * Sync a project (git-sync.service handles duplicate prevention)
   */
  private async syncProjectIfDue(project: ProjectEntity) {
    try {
      this.logger.log(`Triggering periodic sync for project ${project.id} (${project.name})`);
      
      await this.gitSyncService.syncRepository({
        projectIdentifier: project.id,
        projectId: project.id,
      });
    } catch (error) {
      this.logger.error(`Error syncing project ${project.id}:`, error);
    }
  }
}
