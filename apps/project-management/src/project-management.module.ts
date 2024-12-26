import { DatabaseModule, UploadJwtConfigService,  } from '@app/common';
import { MemberEntity, ProjectEntity, MemberProjectEntity, UploadVersionEntity, DeviceEntity, RegulationEntity, RegulationTypeEntity } from '@app/common/database/entities';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectManagementController } from './project-management.controller';
import { ProjectManagementService } from './project-management.service';
import { LoggerModule } from '@app/common/logger/logger.module';
import { ApmModule } from '@app/common/apm/apm.module';
import { OidcModule } from '@app/common/oidc/oidc.module';


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
      DeviceEntity,
    ]),
    OidcModule
  ],
  controllers: [ProjectManagementController],
  providers: [ProjectManagementService],
})
export class ProjectManagementModule {}
