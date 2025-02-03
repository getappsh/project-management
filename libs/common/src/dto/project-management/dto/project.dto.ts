import { ApiProperty, PartialType } from "@nestjs/swagger";
import { MemberResDto } from "./member-project-res.dto";
import { MemberProjectEntity, ProjectEntity, RoleInProject } from "@app/common/database/entities";
import { IsString, IsNotEmpty, IsOptional } from "class-validator";
import { IsValidStringFor } from "@app/common/validators";
import { Pattern } from "@app/common/validators/regex.validator";
import { ProjectTokenDto } from "./project-token.dto";
import { ProjectMemberPreferencesDto } from "./project-member.dto";
import { ReleaseDto } from "../../upload";


export class BaseProjectDto {

  @ApiProperty({ description: 'Unique identifier of the project' })
  id: number;

  @ApiProperty({ description: 'Name of the project'})
  name: string;

  @ApiProperty({ required: false })
  description?: string;

  @ApiProperty({ required: false,  description: 'Status of the project (active, completed, on-hold)'})
  status?: string; // Needs to be an enum

  fromProjectEntity(project: ProjectEntity) {
    this.id = project.id;
    this.name = project.name;
    this.description = project.description;
    // this.status = project.status;
    return this;
  }
  
}

export class ProjectMemberContextDto {
  @ApiProperty({ enum: RoleInProject })
  role?: RoleInProject

  @ApiProperty()
  preferences: ProjectMemberPreferencesDto

  fromMemberProjectEntity(memberProject: MemberProjectEntity) {
    this.role = memberProject.role;
    this.preferences = ProjectMemberPreferencesDto.fromMemberEntity(memberProject);
    return this;
  }
}

export class MinimalReleaseDto {
  @ApiProperty()
  id: string;
  
  @ApiProperty()
  version: string;
  
  @ApiProperty({required: false})
  name?: string;
 
  @ApiProperty()
  requiredRegulationsCount: number;
  
  @ApiProperty()
  compliantRegulationsCount: number;

  static fromReleaseDto(release: ReleaseDto) {
    const dto = new MinimalReleaseDto();
    dto.id = release.id;
    dto.version = release.version;
    dto.name = release.name;
    dto.requiredRegulationsCount = release.requiredRegulationsCount;
    dto.compliantRegulationsCount = release.compliantRegulationsCount;
    return dto;
  }
}


export class ProjectReleasesChangedEvent {

  projectId: number;

  latestRelease?: MinimalReleaseDto;

  upcomingRelease?: MinimalReleaseDto;
}


export class ProjectSummaryDto{ 

  @ApiProperty({ required: false, description: 'Latest release of the project' })
  latestRelease?: MinimalReleaseDto

  @ApiProperty({ required: false, description: 'Upcoming release of the project' })
  upcomingRelease?: MinimalReleaseDto
}

export class ProjectDto extends BaseProjectDto {

  @ApiProperty({ description: 'Owner of the project' })
  owner: string;

  @ApiProperty({ required: false, description: "Number of members in the project" })
  numMembers?: number

  @ApiProperty({ description: 'Number of versions available for the project', example: 5 })
  versions: number;

  @ApiProperty({ required: false, type: ProjectMemberContextDto, description: 'Current member context' })
  memberContext?: ProjectMemberContextDto

  @ApiProperty({ required: false, type: ProjectSummaryDto, description: 'Summary of the project' })
  summary?: ProjectSummaryDto

  fromProjectEntity(project: ProjectEntity) {
    super.fromProjectEntity(project);

    this.versions = project.releases?.length;
    this.numMembers = project.memberProject?.length;
    this.summary = project.projectSummary;

    const ownerEntity = project.memberProject?.find(mp => mp.role === RoleInProject.PROJECT_OWNER);
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
  @IsValidStringFor(Pattern.NOT_ONLY_NUMBERS)
  name: string;

  @IsString()
  @IsOptional()
  @ApiProperty({ required: false })
  description: string;

  username: string;
}

export class EditProjectDto extends PartialType(CreateProjectDto) {
  projectIdentifier: string | number;
  projectId: number;
}