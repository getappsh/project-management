import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DeviceEntity, ProjectEntity, ProjectType } from '@app/common/database/entities';
import { ConfigService } from './config.service';

/**
 * Runs once on application startup.
 *
 * For every device already in the database that does not yet have a
 * `config:{deviceId}` project, this service:
 *   1. Creates the CONFIG project
 *   2. Creates a draft revision with the 3 default groups:
 *      getapp_metadata, getapp_enrollment, getapp_config
 *   3. Auto-links applicable CONFIG_MAP associations
 *
 * The operation is fully idempotent – devices that already have a config
 * project are skipped.
 *
 * New devices are handled by the discovery flow via `ensureDeviceConfigProject`.
 */
@Injectable()
export class ConfigProjectProvisioningService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ConfigProjectProvisioningService.name);

  constructor(
    @InjectRepository(DeviceEntity)
    private readonly deviceRepo: Repository<DeviceEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.provisionAll();
    } catch (err) {
      // Log but never crash the service – can be retried on next boot
      this.logger.error(`Config project provisioning failed: ${(err as Error)?.message}`, (err as Error)?.stack);
    }
  }

  private async provisionAll(): Promise<void> {
    const devices = await this.deviceRepo.find();
    if (devices.length === 0) return;

    // Fetch all existing config project names in one query to avoid N+1 lookups
    const existingProjects = await this.projectRepo.find({
      where: { projectType: ProjectType.CONFIG },
      select: ['name'],
    });
    const existingNames = new Set(existingProjects.map((p) => p.name));

    const toProvision = devices.filter((d) => !existingNames.has(`config:${d.ID}`));

    this.logger.log(
      `Config project provisioning: ${devices.length} device(s) total, ` +
      `${devices.length - toProvision.length} already provisioned, ` +
      `${toProvision.length} to create.`,
    );

    if (toProvision.length === 0) return;

    let created = 0;
    for (const device of toProvision) {
      await this.configService.ensureDeviceConfigProject(device.ID);
      created++;
    }

    this.logger.log(`Config project provisioning complete – created ${created} project(s).`);
  }
}
