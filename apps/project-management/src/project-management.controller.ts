import { ProjectManagementTopics } from '@app/common/microservice-client/topics';
import { Controller, Logger } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { ProjectManagementService } from './project-management.service';
import { DeviceResDto } from '../../../libs/common/src/dto/project-management/dto/device-res.dto';
import {
  EditProjectMemberDto, CreateProjectDto, AddMemberToProjectDto, 
  ProjectTokenDto, MemberResDto, MemberProjectsResDto,
  CreateRegulationDto,
  UpdateRegulationDto,
  RegulationParams,
  ProjectMemberParams
} from '@app/common/dto/project-management';
import { RpcPayload } from '@app/common/microservice-client';
import * as fs from 'fs';
import { AuthUser } from './utils/auth-user.decorator';
import { MemberInProject } from './decorators/member-in-project.decorator';
import { RoleInProject } from '@app/common/database/entities';

@Controller()
export class ProjectManagementController {
  private readonly logger = new Logger(ProjectManagementController.name);

  constructor(private readonly projectManagementService: ProjectManagementService) { }


  @MessagePattern(ProjectManagementTopics.CREATE_PROJECT)
  createProject(@RpcPayload() project: CreateProjectDto) {
    return this.projectManagementService.createProject(project);
  }

  @MemberInProject(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.ADD_PROJECT_NEW_MEMBER)
  addMemberToProject(@RpcPayload() projectMember: AddMemberToProjectDto ) {
    return this.projectManagementService.addMemberToProject(projectMember);
  }

  @MemberInProject(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.REMOVE_PROJECT_MEMBER)
  removeMemberFromProject(@RpcPayload() params: ProjectMemberParams, @AuthUser("email") authEmail: string) {
    return this.projectManagementService.removeMemberFromProject(params, authEmail);
  }

  @MemberInProject(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.EDIT_PROJECT_MEMBER)
  editProjectMember(@RpcPayload() projectMember: EditProjectMemberDto): Promise<MemberResDto> {
    return this.projectManagementService.editProjectMember(projectMember);
  }

  @MessagePattern(ProjectManagementTopics.GET_USER_PROJECTS)
  getUserProjects(@RpcPayload("stringValue") email: string): Promise<MemberProjectsResDto> {
    return this.projectManagementService.getUserProjects(email);
  }

  @MemberInProject()
  @MessagePattern(ProjectManagementTopics.CREATE_PROJECT_TOKEN)
  createToken(@RpcPayload("projectId")  projectId: number): Promise<ProjectTokenDto> {
    return this.projectManagementService.createToken(projectId);
  }

  @MemberInProject()
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_RELEASES)
  getProjectReleases(@RpcPayload('projectId') projectId: number) {
    return this.projectManagementService.getProjectReleases(projectId);
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

  @MessagePattern(ProjectManagementTopics.GET_REGULATION_TYPES)
  getRegulationTypes(){
    return this.projectManagementService.getRegulationTypes()
  }

  @MemberInProject()
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_REGULATIONS)
  getProjectRegulations(@RpcPayload('projectId') projectId: number){
    return this.projectManagementService.getProjectRegulations(projectId)
  }

  
  @MemberInProject()
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_REGULATION_BY_ID)
  getRegulationById(@RpcPayload() params: RegulationParams){
    return this.projectManagementService.getRegulationById(params)
  }

  @MemberInProject(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.CREATE_PROJECT_REGULATION)
  createRegulation(@RpcPayload() regulation: CreateRegulationDto){
    return this.projectManagementService.createRegulation(regulation)
  }

  @MemberInProject(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.UPDATE_PROJECT_REGULATION)
  updateRegulation(@RpcPayload() regulation: UpdateRegulationDto){
    return this.projectManagementService.updateRegulation(regulation)
  }

  @MemberInProject(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.DELETE_PROJECT_REGULATION)
  deleteRegulation(@RpcPayload() params: RegulationParams){
    return this.projectManagementService.deleteRegulation(params)
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
