import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DeploymentReportCacheService } from './deployment-report-cache.service';

@Injectable()
export class DeploymentReportCacheScheduleService {
  private readonly logger = new Logger(DeploymentReportCacheScheduleService.name);

  constructor(
    private readonly deploymentReportCacheService: DeploymentReportCacheService,
  ) {}

  /**
   * Runs every day at 2 AM to update deployment report cache for all projects
   * Cron schedule: "0 2 * * *" means 2:00 AM every day
   *
   * Behavior:
   * - Processes projects sequentially (one after another)
   * - Adds configurable delay between each project to prevent system overload
   * - Default delay: 2000ms (configurable via DEPLOYMENT_REPORT_PROCESS_DELAY_MS env var)
   * - Gracefully handles failures - continues with next project if one fails
   */
  @Cron('0 2 * * *')
  async updateCacheSchedule() {
    this.logger.log('Starting scheduled cache update at 2 AM');

    try {
      await this.deploymentReportCacheService.updateAllProjectReportsCache();
      this.logger.log('Scheduled cache update completed successfully');
    } catch (error) {
      this.logger.error(`Error during scheduled cache update: ${error.message}`, error.stack);
    }
  }
}
