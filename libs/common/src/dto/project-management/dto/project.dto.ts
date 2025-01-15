import { ApiProperty } from "@nestjs/swagger";
import { MemberResDto } from "./member-project-res.dto";
import { ProjectEntity, RoleInProject } from "@app/common/database/entities";
import { IsString, IsNotEmpty, IsOptional, ValidateIf } from "class-validator";
import { RegulationDto } from "./regulation.dto";
import { Transform } from "class-transformer";
import { BadRequestException } from "@nestjs/common";
import { IsValidStringFor } from "@app/common/validators";
import { Pattern } from "@app/common/validators/regex.validator";

export class BaseProjectDto {

  @ApiProperty({ description: 'Unique identifier of the project' })
  id: number;

  @ApiProperty({ description: 'Name of the project'})
  name: string;

  @ApiProperty({ required: false,  description: 'Status of the project (active, completed, on-hold)'})
  status?: string; // Needs to be an enum

  fromProjectEntity(project: ProjectEntity) {
    this.id = project.id;
    this.name = project.name;
    // this.status = project.status;
    return this;
  }
  
}

export class ExtendedProjectDto extends BaseProjectDto {

  @ApiProperty({ description: 'Owner of the project' })
  owner: string;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty({ required: false, type: String, isArray: true })
  tokens?: string[]

  @ApiProperty({ required: false, type: RegulationDto, isArray: true })
  regulation?: RegulationDto[]

  @ApiProperty({ required: false, type: MemberResDto, isArray: true })
  members?: MemberResDto[]

  @ApiProperty({ description: 'Number of versions available for the project', example: 5 })
  versions: number;

  fromProjectEntity(project: ProjectEntity) {
    super.fromProjectEntity(project);

    this.description = project.description;
    this.tokens = project.tokens;

    this.versions = project.releases?.length

    if (project.regulations) {
      this.regulation = project.regulations.map(regulation => new RegulationDto().fromRegulationEntity(regulation))
    }

    if (project.memberProject){
      this.members = project.memberProject.map(memberProject => new MemberResDto().fromMemberProjectEntity(memberProject))
    }

    this.owner = this.members?.find(mp => mp.role === RoleInProject.PROJECT_OWNER)?.getName();



    return this;
  }

  toString() {
    return JSON.stringify(this);
  }
}


export class CreateProjectDto {

  @IsString()
  @IsNotEmpty()
  @ApiProperty({ required: false })
  @IsValidStringFor(Pattern.SINGLE_WORD)
  name: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ required: false })
  description: string;

  username: string;
}