import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, Not, IsNull } from 'typeorm';
import { ProjectEntity } from '@app/common/database/entities';
import { ProjectManagementService } from './project-management.service';
import { TimeoutRepeatTask } from '@app/common/safe-cron/timeout-repeated-task.decorator';

/** Number of days after which an archived project is permanently deleted. */
const ARCHIVE_RETENTION_DAYS = Number(process.env.ARCHIVE_RETENTION_DAYS ?? 90);

@Injectable()
export class ArchiveCleanupScheduler {
  private readonly logger = new Logger(ArchiveCleanupScheduler.name);

  constructor(
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    private readonly projectManagementService: ProjectManagementService,
  ) {}

  /**
   * Runs once per day. Permanently deletes any project that has been archived
   * for longer than ARCHIVE_RETENTION_DAYS (default: 90 days).
   */
  @TimeoutRepeatTask({
    name: 'archive-cleanup',
    initialTimeout: 60_000,                 // Start 1 minute after service starts
    repeatTimeout: 24 * 60 * 60 * 1000,     // Repeat every 24 hours
    acquireFailTimeout: 60 * 60 * 1000,     // Retry after 1 hour if lock not acquired
  })
  async cleanupExpiredArchivedProjects(): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - ARCHIVE_RETENTION_DAYS);

    const expiredProjects = await this.projectRepo.find({
      select: { id: true, name: true, archivedAt: true },
      where: {
        archivedAt: LessThan(cutoff),
      },
    });

    if (expiredProjects.length === 0) {
      this.logger.debug('No expired archived projects found');
      return;
    }

    this.logger.log(
      `Found ${expiredProjects.length} archived project(s) past ${ARCHIVE_RETENTION_DAYS}-day retention. Permanently deleting...`,
    );

    for (const project of expiredProjects) {
      try {
        await this.projectManagementService.permanentlyDeleteProject({ projectId: project.id, projectIdentifier: project.id });
        this.logger.log(`Permanently deleted archived project: ${project.name} (id=${project.id})`);
      } catch (err: any) {
        this.logger.error(`Failed to permanently delete project ${project.id}: ${err?.message}`);
      }
    }
  }
}
