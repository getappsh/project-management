import { ApiProperty } from "@nestjs/swagger";
import { MemberResDto } from "./member-project-res.dto";
import { ProjectEntity, RoleInProject } from "@app/common/database/entities";
import { IsString, IsNotEmpty, IsOptional } from "class-validator";
import { IsValidStringFor } from "@app/common/validators";
import { Pattern } from "@app/common/validators/regex.validator";
import { ProjectTokenDto } from "./project-token.dto";

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

export class ProjectDto extends BaseProjectDto {

  @ApiProperty({ description: 'Owner of the project' })
  owner: string;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty({ required: false, description: "Number of members in the project" })
  numMembers?: number

  @ApiProperty({ description: 'Number of versions available for the project', example: 5 })
  versions: number;

  @ApiProperty({ required: false, description: 'Latest release of the project' })
  latestRelease?: string;

  @ApiProperty({ required: false,  description: 'Upcoming release' })
  upcomingRelease?: string;

  @ApiProperty({required: false, description: 'Upcoming release stage' })
  upcomingReleaseStage?: string;

  fromProjectEntity(project: ProjectEntity) {
    super.fromProjectEntity(project);

    this.description = project.description;
    this.versions = project.releases?.length;
    this.numMembers = project.memberProject.length;

    const ownerEntity =project.memberProject?.find(mp => mp.role === RoleInProject.PROJECT_OWNER);
    if(ownerEntity){
      this.owner = new MemberResDto().fromMemberProjectEntity(ownerEntity)?.getName();
    }
    
    return this;
  }

  toString() {
    return JSON.stringify(this);
  }
}

export class DetailedProjectDto extends ProjectDto {

  @ApiProperty({type: Date, })
  createdAt: Date

  @ApiProperty({ required: false, type: MemberResDto, isArray: true })
  members?: MemberResDto[]

  
  @ApiProperty({ required: false, type: ProjectTokenDto, isArray: true })
  tokens?: ProjectTokenDto[]


  fromProjectEntity(project: ProjectEntity) {
    super.fromProjectEntity(project);
    this.createdAt = project.createdDate;
    this.members = project.memberProject?.map(memberProject => new MemberResDto().fromMemberProjectEntity(memberProject));
    this.tokens = project.tokens?.map(token => ProjectTokenDto.fromProjectTokenEntity(token))
    return this;
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