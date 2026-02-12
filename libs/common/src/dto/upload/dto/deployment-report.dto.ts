import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, ArrayMinSize } from "class-validator";

export class ReleaseReportDto {
  @ApiProperty({ description: 'Project ID', type: Number })
  projectId: number;

  @ApiProperty({ description: 'Project name', type: String })
  projectName: string;

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
    example: {
      'ProjectA': [
        {
          projectId: 1,
          projectName: 'ProjectA',
          releaseName: 'v1.0.0',
          version: '1.0.0',
          downloadedCount: 10,
          installedCount: 8,
          activeDeliveryCount: 12,
          offeredDevicesCount: 15,
          deploymentPercentage: 66.67
        }
      ],
      'ProjectB': [
        {
          projectId: 2,
          projectName: 'ProjectB',
          releaseName: 'v2.0.0',
          version: '2.0.0',
          downloadedCount: 5,
          installedCount: 4,
          activeDeliveryCount: 6,
          offeredDevicesCount: 10,
          deploymentPercentage: 66.67
        }
      ]
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
  @ApiProperty({ 
    description: 'Deployment reports organized by project name, each containing an array of release reports',
    type: 'object',
    example: {
      'ProjectA': [
        {
          projectId: 1,
          projectName: 'ProjectA',
          releaseName: 'v1.0.0',
          version: '1.0.0',
          downloadedCount: 10,
          installedCount: 8,
          activeDeliveryCount: 12,
          offeredDevicesCount: 15,
          deploymentPercentage: 66.67
        }
      ]
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

export class MultiProjectDeploymentReportDto {
  @ApiProperty({ 
    description: 'Deployment reports organized by project name, each containing an array of release reports',
    type: 'object',
    example: {
      'ProjectA': [
        {
          projectId: 1,
          projectName: 'ProjectA',
          releaseName: 'v1.0.0',
          version: '1.0.0',
          downloadedCount: 10,
          installedCount: 8,
          activeDeliveryCount: 12,
          offeredDevicesCount: 15,
          deploymentPercentage: 66.67
        }
      ],
      'ProjectB': [
        {
          projectId: 2,
          projectName: 'ProjectB',
          releaseName: 'v2.0.0',
          version: '2.0.0',
          downloadedCount: 5,
          installedCount: 4,
          activeDeliveryCount: 6,
          offeredDevicesCount: 10,
          deploymentPercentage: 66.67
        }
      ]
    }
  })
  reports: Record<string, ReleaseReportDto[]>;

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
  @ApiProperty({ description: 'Whether to generate a fresh report or use cached data', type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;
}

export class GetMultiProjectDeploymentReportParams {
  @ApiProperty({ description: 'Whether to generate a fresh report or use cached data', type: Boolean, required: false })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;
}
