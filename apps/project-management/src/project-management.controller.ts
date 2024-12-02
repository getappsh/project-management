import { ProjectManagementTopics } from '@app/common/microservice-client/topics';
import { Controller, Logger } from '@nestjs/common';
import { UseGuards } from '@nestjs/common/decorators/core/use-guards.decorator';
import { MessagePattern } from '@nestjs/microservices';
import { ProjectManagementService } from './project-management.service';
import { MemberInProjectGuard } from './guards/member-in-project.guard';
import { MemberProjectEntity } from '@app/common/database/entities';
import { DeviceResDto } from '../../../libs/common/src/dto/project-management/dto/device-res.dto';
import {
  EditProjectMemberDto, ProjectConfigDto, ProjectDto, ProjectMemberDto, 
  ProjectTokenDto, ProjectConfigResDto, MemberResDto, MemberProjectsResDto
} from '@app/common/dto/project-management';
import { RpcPayload } from '@app/common/microservice-client';
import * as fs from 'fs';

@Controller()
export class ProjectManagementController {
  private readonly logger = new Logger(ProjectManagementController.name);

  constructor(private readonly projectManagementService: ProjectManagementService) { }


  @MessagePattern(ProjectManagementTopics.CREATE_PROJECT)
  createProject(@RpcPayload() data: { member: any, project: ProjectDto }) {
    return this.projectManagementService.createProject(data);
  }

  @MessagePattern(ProjectManagementTopics.GET_PROJECT_CONFIG_OPTION)
  getProjectConfigOption(): Promise<ProjectConfigResDto> {
    return this.projectManagementService.getProjectConfigOption();
  }

  @MessagePattern(ProjectManagementTopics.SET_PROJECT_CONFIG_OPTION)
  setProjectConfigOption(@RpcPayload() configOptions: ProjectConfigDto): Promise<ProjectConfigDto> {
    return this.projectManagementService.setProjectConfigOption(configOptions);
  }

  @MessagePattern(ProjectManagementTopics.ADD_NEW_MEMBER)
  addMemberToProject(@RpcPayload() data: { user: any, projectMember: ProjectMemberDto }) {
    return this.projectManagementService.addMemberToProject(data);
  }

  @MessagePattern(ProjectManagementTopics.REMOVE_MEMBER)
  removeMemberFromProject(@RpcPayload() data: any) {
    return this.projectManagementService.removeMemberFromProject(data);
  }

  @MessagePattern(ProjectManagementTopics.EDIT_MEMBER)
  editMember(@RpcPayload() data: { user: any, projectMember: EditProjectMemberDto }): Promise<MemberResDto> {
    return this.projectManagementService.editMember(data);
  }

  @MessagePattern(ProjectManagementTopics.GET_USER_PROJECTS)
  getUserProjects(@RpcPayload("stringValue") email: string): Promise<MemberProjectsResDto> {
    return this.projectManagementService.getUserProjects(email);
  }

  @UseGuards(MemberInProjectGuard)
  @MessagePattern(ProjectManagementTopics.CREATE_TOKEN)
  createToken(@RpcPayload() data: { user: any, projectId: number, memberProject: MemberProjectEntity }): Promise<ProjectTokenDto> {
    return this.projectManagementService.createToken(data);
  }
  @UseGuards(MemberInProjectGuard)
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_RELEASES)
  getProjectReleases(@RpcPayload() data: { user: any, projectId: number, memberProject: MemberProjectEntity }) {
    return this.projectManagementService.getProjectReleases(data);
  }

  @MessagePattern(ProjectManagementTopics.GET_DEVICES_BY_CATALOG_ID)
  getDevicesByCatalogId(@RpcPayload("stringValue") catalogId: string): Promise<DeviceResDto[]> {
    return this.projectManagementService.getDevicesByCatalogId(catalogId);
  }
  @MessagePattern(ProjectManagementTopics.GET_DEVICES_BY_PROJECT)
  getDevicesByProject(@RpcPayload()projectId: number): Promise<DeviceResDto[]> {
    return this.projectManagementService.getDevicesByProject(projectId);
  }
  @MessagePattern(ProjectManagementTopics.GET_DEVICES_BY_PLATFORM)
  getDevicesByPlatform(@RpcPayload("stringValue") platform: string): Promise<DeviceResDto[]> {
    return this.projectManagementService.getDevicesByPlatform(platform);
  }

  @MessagePattern(ProjectManagementTopics.CHECK_HEALTH)
  healthCheckSuccess(){
    const version = this.readImageVersion()
    this.logger.log(`Device service - Health checking, Version: ${version}`)
    return "Project-Management is running successfully. Version: " + version
  }

  private readImageVersion(){
    let version = 'unknown'
    try{
      version = fs.readFileSync('NEW_TAG.txt','utf8');
    }catch(error){
      this.logger.error(`Unable to read image version - error: ${error}`)
    }
    return version
  }
}
