import { IsOptional, IsUUID, ValidateIf, IsNotEmpty } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EvaluateRuleDto {
  @ApiPropertyOptional({ description: 'ID of an existing rule to evaluate. Supply either this or `rule`.' })
  @IsOptional()
  @IsUUID()
  ruleId?: string;

  @ApiPropertyOptional({ description: 'Inline rule JSON (rule-engine format). Supply either this or `ruleId`.' })
  @ValidateIf(o => !o.ruleId)
  @IsNotEmpty({ message: 'Either ruleId or rule must be provided' })
  rule?: any;
}

export class EvaluatedDeviceDto {
  @ApiProperty({ description: 'Unique device identifier' })
  deviceId: string;

  @ApiPropertyOptional({ description: 'Human-readable device name' })
  deviceName?: string;

  @ApiPropertyOptional({ description: 'Operating system of the device' })
  os?: string;

  @ApiPropertyOptional({ description: 'IP address of the device' })
  ip?: string;

  @ApiPropertyOptional({ description: 'MAC address of the device' })
  mac?: string;

  @ApiPropertyOptional({ description: 'Serial number of the device' })
  serialNumber?: string;

  @ApiPropertyOptional({ description: 'Platform name the device belongs to' })
  platformName?: string;

  @ApiPropertyOptional({ description: 'Device type names assigned to the device', type: [String] })
  deviceTypeNames?: string[];

  @ApiPropertyOptional({ description: 'Names of the groups the device belongs to', type: [String] })
  groupNames?: string[];
}

export class AttachedReleaseDto {
  @ApiPropertyOptional({ description: 'Catalog ID of the release' })
  catalogId?: string;

  @ApiPropertyOptional({ description: 'Version string of the release' })
  version?: string;

  @ApiPropertyOptional({ description: 'Project ID the release belongs to' })
  projectId?: string;

  @ApiPropertyOptional({ description: 'Project name the release belongs to' })
  projectName?: string;
}

export class EvaluateRuleResultDto {
  @ApiProperty({ description: 'Devices whose latest discovery data matched the rule', type: [EvaluatedDeviceDto] })
  matchingDevices: EvaluatedDeviceDto[];

  @ApiProperty({ description: 'Total number of devices evaluated' })
  totalDevicesEvaluated: number;

  @ApiProperty({ description: 'Number of devices that matched the rule' })
  matchingCount: number;

  @ApiPropertyOptional({ description: 'Releases the policy is attached to (only present for saved policy rules)', type: [AttachedReleaseDto] })
  attachedReleases?: AttachedReleaseDto[];
}

/** @deprecated use EvaluateRuleResultDto */
export type EvaluateRestrictionResultDto = EvaluateRuleResultDto;
