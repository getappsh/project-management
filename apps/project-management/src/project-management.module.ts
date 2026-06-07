import { DatabaseModule, UploadJwtConfigService,  } from '@app/common';
import { MemberEntity, ProjectEntity, ProjectGitSourceEntity, MemberProjectEntity, UploadVersionEntity, DeviceEntity, RegulationEntity, RegulationTypeEntity, ProjectTokenEntity, DocEntity, PlatformEntity, LabelEntity, ConfigRevisionEntity, ReleaseEntity, AlertEntity } from '@app/common/database/entities';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectManagementController } from './project-management.controller';
import { ProjectManagementService } from './project-management.service';
import { LoggerModule } from '@app/common/logger/logger.module';
import { ApmModule } from '@app/common/apm/apm.module';
import { OidcModule } from '@app/common/oidc/oidc.module';
import { SeederService } from './utils/seeder.service';
import { RegulationService } from './regulation.service';
import { GitSyncService } from './git-sync.service';
import { GitSyncScheduler } from './git-sync-scheduler.service';
import { ArchiveCleanupScheduler } from './archive-cleanup-scheduler.service';
import { PROJECT_ACCESS_SERVICE } from '@app/common/utils/project-access';
import { MicroserviceModule, MicroserviceName, MicroserviceType } from '@app/common/microservice-client';
import { SafeCronModule } from '@app/common/safe-cron';
import { VaultModule } from '@app/common/vault';
import { VaultCredentialsMigrationService } from './vault-credentials-migration.service';
import { ConfigProjectProvisioningService } from './config-project-provisioning.service';
import { ProjectTypeMigrationService } from './project-type-migration.service';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';

@Module({
  imports: [
    ConfigModule.forRoot({isGlobal: true}),
    LoggerModule.forRoot({httpCls: false, jsonLogger: process.env.LOGGER_FORMAT === 'JSON', name: "Project-management"}),
    ApmModule,
    DatabaseModule,
    JwtModule.registerAsync({
      useClass: UploadJwtConfigService
    }),
    TypeOrmModule.forFeature([
      MemberEntity, ProjectEntity, ProjectGitSourceEntity, MemberProjectEntity, UploadVersionEntity, 
      RegulationEntity, RegulationTypeEntity, PlatformEntity,
      DeviceEntity, ProjectTokenEntity, DocEntity, LabelEntity,
      ConfigRevisionEntity, ReleaseEntity, AlertEntity,
    ]),
    OidcModule.forRoot(),
    MicroserviceModule.register({
      name: MicroserviceName.UPLOAD_SERVICE,
      type: MicroserviceType.UPLOAD,
      id: "project-management"
    }),
    MicroserviceModule.register({
      name: MicroserviceName.DEVICE_SERVICE,
      type: MicroserviceType.DEVICE,
      id: "project-management"
    }),
    SafeCronModule,
    VaultModule,
  ],
  controllers: [ProjectManagementController, AlertsController],
  providers: [
    ProjectManagementService, 
    RegulationService,
    GitSyncService,
    GitSyncScheduler,
    ArchiveCleanupScheduler,
    SeederService,
    VaultCredentialsMigrationService,
    ConfigProjectProvisioningService,
    ProjectTypeMigrationService,
    AlertsService,
    {
      provide: PROJECT_ACCESS_SERVICE,
      useExisting: ProjectManagementService
    }
  ],
  exports: [SeederService],
})
export class ProjectManagementModule {}
