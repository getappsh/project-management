import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectEntity, ProjectType } from '@app/common/database/entities';
import { MicroserviceClient, MicroserviceName } from '@app/common/microservice-client';
import { DeviceTopics, UploadTopics } from '@app/common/microservice-client/topics';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class ConfigProjectProvisioningService implements OnModuleInit, OnApplicationBootstrap {
  private readonly logger = new Logger(ConfigProjectProvisioningService.name);

  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepo: Repository<ProjectEntity>,
    @Inject(MicroserviceName.DEVICE_SERVICE) private readonly deviceClient: MicroserviceClient,
    @Inject(MicroserviceName.UPLOAD_SERVICE) private readonly uploadClient: MicroserviceClient,
  ) {}

  async onModuleInit() {
    this.deviceClient.subscribeToResponseOf([DeviceTopics.GET_ALL_DEVICE_IDS]);
    await this.deviceClient.connect();

    this.uploadClient.subscribeToResponseOf([UploadTopics.CONFIG_ENSURE_DEVICE_PROJECT]);
    await this.uploadClient.connect();
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.provisionAll();
    } catch (err) {
      this.logger.error(`Config project provisioning failed: ${(err as Error)?.message}`, (err as Error)?.stack);
    }
  }

  async provisionAll(): Promise<void> {
    const deviceIds = await lastValueFrom(
      this.deviceClient.send<string[]>(DeviceTopics.GET_ALL_DEVICE_IDS, {}),
    ).catch(() => [] as string[]);
    if (deviceIds.length === 0) return;

    const existingProjects = await this.projectRepo.find({
      where: { projectType: ProjectType.CONFIG },
      select: ['name'],
    });
    const existingNames = new Set(existingProjects.map((p) => p.name));

    const toProvision = deviceIds.filter((id) => !existingNames.has(`config:${id}`));

    this.logger.log(
      `Config project provisioning: ${deviceIds.length} device(s) total, ` +
      `${deviceIds.length - toProvision.length} already provisioned, ` +
      `${toProvision.length} to create.`,
    );

    if (toProvision.length === 0) return;

    let created = 0;
    for (const deviceId of toProvision) {
      await lastValueFrom(
        this.uploadClient.send(UploadTopics.CONFIG_ENSURE_DEVICE_PROJECT, { deviceId }),
      );
      created++;
    }

    this.logger.log(`Config project provisioning complete – created ${created} project(s).`);
  }
}
