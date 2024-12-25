import * as dotenv from 'dotenv';
dotenv.config();
import apm from 'nestjs-elastic-apm';

import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { ProjectManagementModule } from './project-management.module';
import { CustomRpcExceptionFilter } from './rpc-exception.filter';
import { MSType, MicroserviceName, MicroserviceType, getClientConfig } from '@app/common/microservice-client';
import { GET_APP_LOGGER } from '@app/common/logger/logger.module';
import { SeederService } from './utils/seeder.service';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    ProjectManagementModule,
    {...getClientConfig(
      {
        type: MicroserviceType.PROJECT_MANAGEMENT, 
        name: MicroserviceName.PROJECT_MANAGEMENT_SERVICE
      }, 
      MSType[process.env.MICRO_SERVICE_TYPE]),
      bufferLogs: true
    }
  );
  app.useLogger(app.get(GET_APP_LOGGER))
  app.useGlobalFilters(new CustomRpcExceptionFilter())
  const seederService = app.get(SeederService);
  seederService.seedRegulationTypes();
  app.listen()
}
bootstrap();