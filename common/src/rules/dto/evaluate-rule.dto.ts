import { IsOptional, IsUUID, ValidateIf, IsNotEmpty } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

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

export interface EvaluatedDeviceDto {
  deviceId: string;
  deviceName?: string;
  os?: string;
  ip?: string;
  mac?: string;
  serialNumber?: string;
  platformName?: string;
  deviceTypeNames?: string[];
}

export interface AttachedReleaseDto {
  catalogId?: string;
  version?: string;
  projectId?: string;
  projectName?: string;
}

export interface EvaluateRuleResultDto {
  matchingDevices: EvaluatedDeviceDto[];
  totalDevicesEvaluated: number;
  matchingCount: number;
  /** Populated when evaluating a saved policy rule — the releases it is attached to. */
  attachedReleases?: AttachedReleaseDto[];
}

/** @deprecated use EvaluateRuleResultDto */
export type EvaluateRestrictionResultDto = EvaluateRuleResultDto;
