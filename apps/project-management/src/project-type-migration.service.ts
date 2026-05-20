import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectEntity, ProjectType } from '@app/common/database/entities';

/**
 * Runs once on application startup.
 *
 * Converts any project whose projectType is still set to the legacy
 * `ProjectType.PRODUCT` value to `ProjectType.APPLICATION`.
 *
 * This is a one-time, idempotent migration – projects that are already
 * APPLICATION (or any other current type) are left untouched.
 */
@Injectable()
export class ProjectTypeMigrationService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProjectTypeMigrationService.name);

  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const result = await this.projectRepo
        .createQueryBuilder()
        .update(ProjectEntity)
        .set({ projectType: ProjectType.APPLICATION })
        .where('project_type = :type', { type: ProjectType.PRODUCT })
        .execute();

      if (result.affected && result.affected > 0) {
        this.logger.log(
          `Migrated ${result.affected} project(s) from type '${ProjectType.PRODUCT}' to '${ProjectType.APPLICATION}'.`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Project-type migration encountered an error: ${error.message}`,
        error.stack,
      );
    }
  }
}
