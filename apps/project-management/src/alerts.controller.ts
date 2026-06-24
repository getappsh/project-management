import { Controller, Logger } from '@nestjs/common';
import { EventPattern, MessagePattern } from '@nestjs/microservices';
import { AlertTopics, AlertTopicsEmit } from '@app/common/microservice-client/topics';
import { RpcPayload } from '@app/common/microservice-client';
import { AlertsService } from './alerts.service';

@Controller()
export class AlertsController {
  private readonly logger = new Logger(AlertsController.name);

  constructor(private readonly alertsService: AlertsService) {}

  @EventPattern(AlertTopicsEmit.SYSTEM_ALERT)
  handleSystemAlert(@RpcPayload() data: any) {
    this.logger.debug(`Received system alert: ${data.type} - ${data.message}`);
    this.alertsService.handleIncomingAlert({
      type: data.type,
      severity: data.severity,
      message: data.message,
      deviceId: data.deviceId,
      projectId: data.projectId,
      catalogId: data.catalogId,
      source: data.source,
      metadata: data.metadata,
    });
  }

  @MessagePattern(AlertTopics.GET_ALERTS)
  async getAlerts(@RpcPayload() data: { limit?: number; since?: string }) {
    this.logger.log(`Get alerts, limit: ${data.limit}, since: ${data.since}`);
    return this.alertsService.getAlerts(data.limit || 10, data.since);
  }

  @MessagePattern(AlertTopics.GET_DEVICE_ALERTS)
  async getDeviceAlerts(@RpcPayload() data: { deviceId: string; limit?: number }) {
    this.logger.log(`Get alerts for device: ${data.deviceId}, limit: ${data.limit}`);
    return this.alertsService.getDeviceAlerts(data.deviceId, data.limit || 20);
  }

  @MessagePattern(AlertTopics.GET_PROJECT_ALERTS)
  async getProjectAlerts(@RpcPayload() data: { projectId?: number; projectName?: string; limit?: number }) {
    this.logger.log(`Get alerts for project: id=${data.projectId}, name=${data.projectName}, limit: ${data.limit}`);
    return this.alertsService.getProjectAlerts(data.limit || 20, data.projectId, data.projectName);
  }
}
