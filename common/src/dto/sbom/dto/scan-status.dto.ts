import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ScanStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

export class ScanStatusResponseDto {
  @ApiProperty({ description: 'Scan job UUID' })
  id: string;

  @ApiProperty({ enum: ScanStatus, description: 'Current status of the scan' })
  status: ScanStatus;

  @ApiProperty({ description: 'Scan target (image name, file path, registry URL, etc.)' })
  target: string;

  @ApiProperty({
    enum: ['docker', 'registry', 'file', 'dir', 'oci-archive'],
    description: 'Type of the scan target',
  })
  targetType: string;

  @ApiProperty({
    enum: ['syft-json', 'spdx-json', 'cyclonedx-json', 'table', 'text'],
    description: 'SBOM output format',
  })
  format: string;

  @ApiPropertyOptional({ description: 'Who or what triggered this scan' })
  triggeredBy?: string;

  @ApiPropertyOptional({ description: 'Error message if the scan failed' })
  error?: string;

  @ApiPropertyOptional({ description: 'Short reason code for the failure' })
  failureReason?: string;

  @ApiProperty({ description: 'Timestamp when the scan was created' })
  createdAt: Date;

  @ApiProperty({ description: 'Timestamp of the last status update' })
  updatedAt: Date;

  @ApiPropertyOptional({ description: 'Timestamp when the scan reached a terminal state' })
  completedAt?: Date;
}
