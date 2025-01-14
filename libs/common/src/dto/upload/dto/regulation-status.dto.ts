import { RegulationStatusEntity } from "@app/common/database/entities";
import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";
import { ProjectIdentifierParams } from "../../project-management";

export class RegulationStatusParams extends ProjectIdentifierParams {

  @ApiProperty({ description: 'Component Version of the regulation' })
  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  version: string

  @ApiProperty({ description: 'Name of the regulation' })
  @IsString()
  @IsNotEmpty()
  @Type(() => String)
  regulation: string
}

export class SetRegulationStatusDto{

  projectIdentifier: string |  number

  regulation: string

  version: string

  projectId: number


  @ApiProperty({ description: 'Value of the regulation' })
  @IsString()
  @IsNotEmpty()
  value: string

  @ApiProperty({ required: false,  description: 'Report Details of the regulation' })
  @IsString()
  @IsOptional()
  reportDetails?: string

}

export class  SetRegulationCompliancyDto {

  projectIdentifier: string |  number

  regulation: string

  version: string

  projectId: number

  @ApiProperty({ description: 'Compliancy of the regulation' })
  @IsBoolean()
  isCompliant: boolean
}


export class RegulationStatusDto  extends RegulationStatusParams{

  @ApiProperty({ description: 'Value of the regulation' })
  value: string

  @ApiProperty({ required: false,  description: 'Report Details of the regulation' })
  reportDetails?: string

  @ApiProperty({ description: 'Compliancy of the regulation' })
  isCompliant: boolean

  @ApiProperty({ description: 'Creation date of the regulation status' })
  createdAt: Date

  @ApiProperty({ description: 'Update date of the regulation status' })
  updatedAt: Date

  fromRegulationStatusEntity(regulationStatus: RegulationStatusEntity) {
    this.value = regulationStatus.value
    this.reportDetails = regulationStatus.reportDetails
    this.isCompliant = regulationStatus.isCompliant
    this.version = regulationStatus?.version?.version
    this.regulation = regulationStatus?.regulation?.name
    this.projectId = regulationStatus?.regulation?.project?.id
    this.createdAt = regulationStatus.createdAt
    this.updatedAt = regulationStatus.updatedAt

    return this

  }
}