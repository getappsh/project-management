import { ApiProperty } from "@nestjs/swagger";

export class ReleaseReportDto {
  @ApiProperty({ description: 'Release name', type: String })
  releaseName: string;

  @ApiProperty({ description: 'Release version', type: String })
  version: string;

  @ApiProperty({ description: 'Number of devices that have downloaded the release', type: Number })
  downloadedCount: number;

  @ApiProperty({ description: 'Number of devices with the release installed', type: Number })
  installedCount: number;

  @ApiProperty({ description: 'Number of devices with ongoing delivery process (includes devices waiting for download and mid-deployment)', type: Number })
  activeDeliveryCount: number;

  @ApiProperty({ description: 'Number of devices the release is offered to based on device type', type: Number })
  offeredDevicesCount: number;

  @ApiProperty({ description: 'Deployment percentage calculated as (installedCount / activeDeliveryCount) * 100', type: Number })
  deploymentPercentage: number;
}

export class DeploymentReportDto {
  @ApiProperty({ description: 'Project ID', type: Number })
  projectId: number;

  @ApiProperty({ description: 'Release name', type: String })
  releaseName: string;

  @ApiProperty({ description: 'Release version', type: String })
  version: string;

  @ApiProperty({ description: 'Number of devices that have downloaded the release', type: Number })
  downloadedCount: number;

  @ApiProperty({ description: 'Number of devices with the release installed', type: Number })
  installedCount: number;

  @ApiProperty({ description: 'Number of devices with ongoing delivery process (includes devices waiting for download and mid-deployment)', type: Number })
  activeDeliveryCount: number;

  @ApiProperty({ description: 'Number of devices the release is offered to based on device type', type: Number })
  offeredDevicesCount: number;

  @ApiProperty({ description: 'Deployment percentage calculated as (installedCount / activeDeliveryCount) * 100', type: Number })
  deploymentPercentage: number;
}

export class GetDeploymentReportParams {
  @ApiProperty({ description: 'Project ID or name', type: [Number, String] })
  projectIdentifier: number | string;

  @ApiProperty({ description: 'Release version' })
  version: string;
}

export class SystemWideDeploymentReportDto {
  @ApiProperty({ 
    description: 'Deployment reports organized by project name, each containing an array of release reports',
    type: 'object',
    additionalProperties: {
      type: 'array',
      items: { $ref: '#/components/schemas/ReleaseReportDto' }
    }
  })
  reports: Record<string, ReleaseReportDto[]>;

  @ApiProperty({ description: 'Timestamp when the report was generated', type: Date })
  generatedAt: Date;

  @ApiProperty({ description: 'Total number of projects', type: Number })
  totalProjects: number;

  @ApiProperty({ description: 'Total number of releases', type: Number })
  totalReleases: number;
}

export class ProjectDeploymentReportDto {
  @ApiProperty({ description: 'Project ID', type: Number })
  projectId: number;

  @ApiProperty({ description: 'Project name', type: String, required: false })
  projectName?: string;

  @ApiProperty({ description: 'Array of deployment reports for this project\'s releases', type: [DeploymentReportDto] })
  reports: DeploymentReportDto[];

  @ApiProperty({ description: 'Timestamp when the report was generated', type: Date })
  generatedAt: Date;
}

export class MultiProjectDeploymentReportDto {
  @ApiProperty({ description: 'Array of project deployment reports', type: [ProjectDeploymentReportDto] })
  projects: ProjectDeploymentReportDto[];

  @ApiProperty({ description: 'Timestamp when the report was generated', type: Date })
  generatedAt: Date;

  @ApiProperty({ description: 'Total number of projects included', type: Number })
  totalProjects: number;

  @ApiProperty({ description: 'Total number of releases across all projects', type: Number })
  totalReleases: number;
}

export class GetSystemWideDeploymentReportParams {
  @ApiProperty({ description: 'Whether to generate a fresh report or use cached data', type: Boolean, required: false })
  forceRefresh?: boolean;
}

export class GetProjectDeploymentReportParams {
  @ApiProperty({ description: 'Project ID or name', type: [Number, String] })
  projectIdentifier: number | string;

  @ApiProperty({ description: 'Whether to generate a fresh report or use cached data', type: Boolean, required: false })
  forceRefresh?: boolean;
}

export class GetMultiProjectDeploymentReportParams {
  @ApiProperty({ description: 'List of project IDs or names to include in the report', type: [Number, String] })
  projectIdentifiers: (number | string)[];

  @ApiProperty({ description: 'Whether to generate a fresh report or use cached data', type: Boolean, required: false })
  forceRefresh?: boolean;
}
