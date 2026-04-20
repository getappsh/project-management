import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { ProjectManagementTopics } from '@app/common/microservice-client/topics';
import { RpcPayload, UserContextInterceptor } from '@app/common/microservice-client';
import { ConfigService } from './config.service';
import {
  AddConfigMapAssociationDto,
  ApplyConfigRevisionDto,
  DeleteConfigEntryDto,
  DeleteConfigGroupDto,
  GetConfigRevisionByIdDto,
  GetConfigRevisionsDto,
  GetDeviceConfigDto,
  RemoveConfigMapAssociationDto,
  UpsertConfigEntryDto,
  UpsertConfigGroupDto,
} from '@app/common/dto/project-management';

@Controller()
@UseInterceptors(UserContextInterceptor)
export class ConfigController {
  private readonly logger = new Logger(ConfigController.name);

  constructor(private readonly configService: ConfigService) {}

  // ---------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------

  @MessagePattern(ProjectManagementTopics.CONFIG_UPSERT_GROUP)
  upsertGroup(@RpcPayload() dto: UpsertConfigGroupDto) {
    return this.configService.upsertGroup(dto);
  }

  @MessagePattern(ProjectManagementTopics.CONFIG_DELETE_GROUP)
  deleteGroup(@RpcPayload() dto: DeleteConfigGroupDto) {
    return this.configService.deleteGroup(dto);
  }

  // ---------------------------------------------------------------------------
  // Entries
  // ---------------------------------------------------------------------------

  @MessagePattern(ProjectManagementTopics.CONFIG_UPSERT_ENTRY)
  upsertEntry(@RpcPayload() dto: UpsertConfigEntryDto) {
    return this.configService.upsertEntry(dto);
  }

  @MessagePattern(ProjectManagementTopics.CONFIG_DELETE_ENTRY)
  deleteEntry(@RpcPayload() dto: DeleteConfigEntryDto) {
    return this.configService.deleteEntry(dto);
  }

  // ---------------------------------------------------------------------------
  // Revisions
  // ---------------------------------------------------------------------------

  @MessagePattern(ProjectManagementTopics.CONFIG_APPLY_REVISION)
  applyRevision(@RpcPayload() dto: ApplyConfigRevisionDto) {
    return this.configService.applyRevision(dto);
  }

  @MessagePattern(ProjectManagementTopics.CONFIG_GET_REVISIONS)
  getRevisions(@RpcPayload() dto: GetConfigRevisionsDto) {
    return this.configService.getRevisions(dto);
  }

  @MessagePattern(ProjectManagementTopics.CONFIG_GET_REVISION_BY_ID)
  getRevisionById(@RpcPayload() dto: GetConfigRevisionByIdDto) {
    return this.configService.getRevisionById(dto);
  }

  // ---------------------------------------------------------------------------
  // ConfigMap associations
  // ---------------------------------------------------------------------------

  @MessagePattern(ProjectManagementTopics.CONFIG_ADD_MAP_ASSOCIATION)
  addConfigMapAssociation(@RpcPayload() dto: AddConfigMapAssociationDto) {
    return this.configService.addConfigMapAssociation(dto);
  }

  @MessagePattern(ProjectManagementTopics.CONFIG_REMOVE_MAP_ASSOCIATION)
  removeConfigMapAssociation(@RpcPayload() dto: RemoveConfigMapAssociationDto) {
    return this.configService.removeConfigMapAssociation(dto);
  }

  @MessagePattern(ProjectManagementTopics.CONFIG_GET_MAP_ASSOCIATIONS)
  getConfigMapAssociations(@RpcPayload() payload: { configMapProjectIdentifier: number | string }) {
    return this.configService.getConfigMapAssociations(payload.configMapProjectIdentifier);
  }

  // ---------------------------------------------------------------------------
  // Agent endpoint – get final device config
  // ---------------------------------------------------------------------------

  @MessagePattern(ProjectManagementTopics.CONFIG_GET_DEVICE_CONFIG)
  getDeviceConfig(@RpcPayload() dto: GetDeviceConfigDto) {
    return this.configService.getDeviceConfig(dto);
  }
}
