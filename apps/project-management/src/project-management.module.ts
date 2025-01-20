import { DatabaseModule, UploadJwtConfigService,  } from '@app/common';
import { MemberEntity, ProjectEntity, MemberProjectEntity, UploadVersionEntity, DeviceEntity, RegulationEntity, RegulationTypeEntity, ProjectTokenEntity } from '@app/common/database/entities';
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
import { PROJECT_ACCESS_SERVICE } from '@app/common/utils/project-access';
import { MicroserviceModule, MicroserviceName, MicroserviceType } from '@app/common/microservice-client';

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
      MemberEntity, ProjectEntity, MemberProjectEntity, UploadVersionEntity, 
      RegulationEntity, RegulationTypeEntity,
      DeviceEntity, ProjectTokenEntity
    ]),
    OidcModule.forRoot(),
    MicroserviceModule.register({
      name: MicroserviceName.UPLOAD_SERVICE,
      type: MicroserviceType.UPLOAD,
    }),
  ],
  controllers: [ProjectManagementController],
  providers: [
    ProjectManagementService, 
    RegulationService, 
    SeederService,
    {
      provide: PROJECT_ACCESS_SERVICE,
      useClass: ProjectManagementService
    }
  ],
  exports: [SeederService],
})
export class ProjectManagementModule {}
