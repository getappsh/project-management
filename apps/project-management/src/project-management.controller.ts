import { ProjectManagementTopics } from '@app/common/microservice-client/topics';
import { Controller, Get } from '@nestjs/common';
import { UseGuards } from '@nestjs/common/decorators/core/use-guards.decorator';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ProjectManagementService } from './project-management.service';
import { MemberInProjectGuard } from './guards/member-in-project.guard';
import { MemberProjectEntity } from '@app/common/database/entities';
import { DeviceResDto } from '../../../libs/common/src/dto/project-management/dto/device-res.dto';
import {
  EditProjectMemberDto, ProjectConfigDto, ProjectDto, ProjectMemberDto, 
  ProjectTokenDto, ProjectConfigResDto, MemberResDto, MemberProjectsResDto
} from '@app/common/dto/project-management';

@Controller()
export class ProjectManagementController {
  constructor(private readonly projectManagementService: ProjectManagementService) { }


  @MessagePattern(ProjectManagementTopics.CREATE_PROJECT)
  createProject(data: { member: any, project: ProjectDto }) {
    return this.projectManagementService.createProject(data);
  }

  @MessagePattern(ProjectManagementTopics.GET_PROJECT_CONFIG_OPTION)
  getProjectConfigOption(): Promise<ProjectConfigResDto> {
    return this.projectManagementService.getProjectConfigOption();
  }

  @MessagePattern(ProjectManagementTopics.SET_PROJECT_CONFIG_OPTION)
  setProjectConfigOption(configOptions: ProjectConfigDto): Promise<ProjectConfigDto> {
    return this.projectManagementService.setProjectConfigOption(configOptions);
  }

  @MessagePattern(ProjectManagementTopics.ADD_NEW_MEMBER)
  addMemberToProject(data: { user: any, projectMember: ProjectMemberDto }) {
    return this.projectManagementService.addMemberToProject(data);
  }

  @MessagePattern(ProjectManagementTopics.REMOVE_MEMBER)
  removeMemberFromProject(data: any) {
    return this.projectManagementService.removeMemberFromProject(data);
  }

  @MessagePattern(ProjectManagementTopics.EDIT_MEMBER)
  editMember(data: { user: any, projectMember: EditProjectMemberDto }): Promise<MemberResDto> {
    return this.projectManagementService.editMember(data);
  }

  @MessagePattern(ProjectManagementTopics.GET_USER_PROJECTS)
  getUserProjects(@Payload("stringValue") email: string): Promise<MemberProjectsResDto> {
    return this.projectManagementService.getUserProjects(email);
  }

  @UseGuards(MemberInProjectGuard)
  @MessagePattern(ProjectManagementTopics.CREATE_TOKEN)
  createToken(data: { user: any, projectId: number, memberProject: MemberProjectEntity }): Promise<ProjectTokenDto> {
    return this.projectManagementService.createToken(data);
  }
  @UseGuards(MemberInProjectGuard)
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_RELEASES)
  getProjectReleases(data: { user: any, projectId: number, memberProject: MemberProjectEntity }) {
    return this.projectManagementService.getProjectReleases(data);
  }

  @MessagePattern(ProjectManagementTopics.GET_DEVICES_BY_CATALOG_ID)
  getDevicesByCatalogId(@Payload("stringValue") catalogId: string): Promise<DeviceResDto[]> {
    return this.projectManagementService.getDevicesByCatalogId(catalogId);
  }
  @MessagePattern(ProjectManagementTopics.GET_DEVICES_BY_PROJECT)
  getDevicesByProject(projectId: number): Promise<DeviceResDto[]> {
    return this.projectManagementService.getDevicesByProject(projectId);
  }
  @MessagePattern(ProjectManagementTopics.GET_DEVICES_BY_PLATFORM)
  getDevicesByPlatform(@Payload("stringValue") platform: string): Promise<DeviceResDto[]> {
    return this.projectManagementService.getDevicesByPlatform(platform);
  }

  @MessagePattern(ProjectManagementTopics.CHECK_HEALTH)
  healthCheckSuccess(){
    return "Project management service is success"
  }
}
