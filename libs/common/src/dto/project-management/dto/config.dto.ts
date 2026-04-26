import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, ValidateNested, ArrayNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { ConfigRevisionStatus } from '@app/common/database/entities';

// ---------------------------------------------------------------------------
// Entry DTOs
// ---------------------------------------------------------------------------

export class ConfigEntryDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  key: string;

  /** Value is always resolved (vault refs expanded) when returned to the agent. */
  @ApiProperty({ required: false })
  value: string | null;

  @ApiProperty({ description: 'Whether the value is stored as a secret in Vault' })
  isSensitive: boolean;
}

export class UpsertConfigEntryDto {
  @ApiProperty({ description: 'Project identifier (id or name)' })
  @IsNotEmpty()
  projectIdentifier: number | string;

  @ApiProperty({ description: 'Group name' })
  @IsString()
  @IsNotEmpty()
  groupName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  value?: string;

  @ApiProperty({ required: false, default: false })
  @IsBoolean()
  @IsOptional()
  isSensitive?: boolean;
}

export class DeleteConfigEntryDto {
  @ApiProperty()
  @IsNotEmpty()
  projectIdentifier: number | string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  groupName: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  key: string;
}

// ---------------------------------------------------------------------------
// Group DTOs
// ---------------------------------------------------------------------------

export class ConfigGroupDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  isGlobal: boolean;

  @ApiProperty({ required: false })
  gitFilePath: string | null;

  @ApiProperty({ type: [ConfigEntryDto] })
  entries: ConfigEntryDto[];
}

export class UpsertConfigGroupDto {
  @ApiProperty({ description: 'Project identifier (id or name)' })
  @IsNotEmpty()
  projectIdentifier: number | string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, default: false })
  @IsBoolean()
  @IsOptional()
  isGlobal?: boolean;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  gitFilePath?: string;

  /** Full list of entries to set on this group. Replaces existing entries. */
  @ApiProperty({ type: [UpsertConfigEntryDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertConfigEntryDto)
  @IsOptional()
  entries?: Omit<UpsertConfigEntryDto, 'projectIdentifier' | 'groupName'>[];
}

export class DeleteConfigGroupDto {
  @ApiProperty()
  @IsNotEmpty()
  projectIdentifier: number | string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  groupName: string;
}

// ---------------------------------------------------------------------------
// Revision DTOs
// ---------------------------------------------------------------------------

export class ConfigRevisionDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  projectId: number;

  @ApiProperty()
  revisionNumber: number;

  @ApiProperty({ enum: ConfigRevisionStatus })
  status: ConfigRevisionStatus;

  @ApiProperty({ required: false })
  appliedBy: string | null;

  @ApiProperty({ required: false })
  appliedAt: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: [ConfigGroupDto], required: false })
  groups?: ConfigGroupDto[];
}

export class ApplyConfigRevisionDto {
  @ApiProperty({ description: 'Project identifier (id or name)' })
  @IsNotEmpty()
  projectIdentifier: number | string;

  @ApiProperty({ required: false, description: 'Who is applying (email / user id)' })
  @IsString()
  @IsOptional()
  appliedBy?: string;
}

export class CreateDraftRevisionDto {
  @ApiProperty({ description: 'Project identifier (id or name)' })
  @IsNotEmpty()
  projectIdentifier: number | string;
}

export class DeleteDraftRevisionDto {
  @ApiProperty({ description: 'Project identifier (id or name)' })
  @IsNotEmpty()
  projectIdentifier: number | string;
}

export class GetConfigRevisionsDto {
  @ApiProperty({ description: 'Project identifier (id or name)' })
  @IsNotEmpty()
  projectIdentifier: number | string;

  /** When true, include groups and entries in each revision */
  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  includeGroups?: boolean;
}

export class GetConfigRevisionByIdDto {
  @ApiProperty()
  @IsInt()
  revisionId: number;

  /** When true, include groups and entries */
  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  includeGroups?: boolean;
}

// ---------------------------------------------------------------------------
// ConfigMap Association DTOs
// ---------------------------------------------------------------------------

export class ConfigMapAssociationDto {
  @ApiProperty()
  id: number;

  @ApiProperty()
  configMapProjectId: number;

  @ApiProperty({ required: false })
  deviceTypeId: number | null;

  @ApiProperty({ required: false, description: 'Specific device ID this association targets, or null for device-type / global rules' })
  deviceId: string | null;

  @ApiProperty({ required: false, description: 'Direct link to a specific CONFIG project, or null for device-type / device-id / global rules' })
  configProjectId: number | null;
}

export class AddConfigMapAssociationDto {
  @ApiProperty({ description: 'ConfigMap project identifier (id or name)' })
  @IsNotEmpty()
  configMapProjectIdentifier: number | string;

  @ApiProperty({ required: false, description: 'Device type ID to associate with. Null = global.' })
  @IsInt()
  @IsOptional()
  deviceTypeId?: number;

  @ApiProperty({ required: false, description: 'Array of device IDs to associate with directly.' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsOptional()
  deviceIds?: string[];
}

export class RemoveConfigMapAssociationDto {
  @ApiProperty()
  @IsInt()
  associationId: number;
}

export class GetConfigMapAssociationsDto {
  @ApiProperty({ description: 'ConfigMap project identifier (id or name)' })
  @IsNotEmpty()
  configMapProjectIdentifier: number | string;
}

/** A ConfigMap project that references a given CONFIG project's device type */
export class ConfigMapForProjectDto {
  @ApiProperty({ description: 'ConfigMap project ID' })
  configMapProjectId: number;

  @ApiProperty({ description: 'ConfigMap project name' })
  configMapProjectName: string;

  @ApiProperty({ description: 'Association ID' })
  associationId: number;

  @ApiProperty({ description: 'Device type ID matched, or null for global associations', required: false })
  deviceTypeId: number | null;
}

export class GetConfigMapsForProjectDto {
  @ApiProperty({ description: 'CONFIG project identifier (id or name)' })
  @IsNotEmpty()
  projectIdentifier: number | string;
}

// ---------------------------------------------------------------------------
// Agent / device config retrieval
// ---------------------------------------------------------------------------

/** Flat key-value map of a single merged group (after globals merge + vault resolution). */
export type ConfigGroupValuesMap = Record<string, string | null>;

/** The final assembled config returned to the agent. */
export class DeviceConfigDto {
  @ApiProperty({ description: 'Device ID this config belongs to' })
  deviceId: string;

  @ApiProperty({ description: 'Revision ID of the device config project used' })
  configRevisionId: number | null;

  /** Group name → key-value pairs. Secrets are already resolved from vault. */
  @ApiProperty({ description: 'Assembled config groups keyed by group name' })
  groups: Record<string, ConfigGroupValuesMap>;

  /** ISO timestamp of when this config was last computed */
  @ApiProperty()
  computedAt: string;
}

export class GetDeviceConfigDto {
  @ApiProperty({ description: 'Device ID' })
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  /**
   * When true (default when called by agent) vault secrets are resolved.
   * Set to false to get the config without secret values (for caching).
   */
  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  resolveSecrets?: boolean;
}

// ---------------------------------------------------------------------------
// GitOps config group sync
// ---------------------------------------------------------------------------

export class GitConfigGroupDto {
  @ApiProperty({ description: 'Group name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false, description: 'Path to a YAML file in the git repo whose key-values populate this group' })
  @IsString()
  @IsOptional()
  gitFilePath?: string;

  @ApiProperty({ required: false, description: 'When true this is the globals group' })
  @IsBoolean()
  @IsOptional()
  isGlobal?: boolean;
}
