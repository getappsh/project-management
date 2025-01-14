import { ApiProperty } from "@nestjs/swagger";
import { MemberResDto } from "./member-project-res.dto";
import { ProjectEntity } from "@app/common/database/entities";
import { IsString, IsNotEmpty, IsOptional, ValidateIf } from "class-validator";
import { RegulationDto } from "./regulation.dto";
import { Expose, Transform, Type } from "class-transformer";
import { BadRequestException } from "@nestjs/common";
import { IsValidStringFor } from "@app/common/validators";
import { Pattern } from "@app/common/validators/regex.validator";


export class ProjectDto {

  @ApiProperty({ required: false })
  id: number;

  @ApiProperty({ required: false })
  name: string;

  @ApiProperty({ required: false })
  description: string;

  @ApiProperty({ required: false, type: String, isArray: true })
  tokens: string[]

  @ApiProperty({ required: false, type: RegulationDto, isArray: true })
  regulation: RegulationDto[]

  @ApiProperty({ required: false, type: MemberResDto, isArray: true })
  members: MemberResDto[]

  fromProjectEntity(project: ProjectEntity) {
    this.id = project.id;
    this.name = project.name;
    this.description = project.description;
    this.tokens = project.tokens;

    if (project.regulations) {
      this.regulation = project.regulations.map(regulation => new RegulationDto().fromRegulationEntity(regulation))
    }

    if (project.memberProject){
      this.members = project.memberProject.map(memberProject => new MemberResDto().fromMemberProjectEntity(memberProject))
    }

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


export class ProjectIdentifierParams{

  @ApiProperty({type: String, description: 'Project identifier (ID or name)'})
  @ValidateIf((o) => typeof o.projectIdentifier === 'string')
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => {
    const isNum = (num) => Number.isFinite ? Number.isFinite(+num) : isFinite(+num)
    
    if (isNum(value)) {
      return parseInt(value, 10);
    }

    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }

    throw new BadRequestException('Invalid project identifier');
  })
  projectIdentifier: string |number;
  

  projectId: number
}