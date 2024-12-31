import { ProjectManagementTopics } from '@app/common/microservice-client/topics';
import { Controller, Logger } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { ProjectManagementService } from './project-management.service';
import { DeviceResDto } from '@app/common/dto/project-management/dto/device-res.dto';
import {
  EditProjectMemberDto, CreateProjectDto, AddMemberToProjectDto, 
  ProjectTokenDto, MemberResDto, MemberProjectsResDto,
  CreateRegulationDto,
  UpdateRegulationDto,
  RegulationParams,
  ProjectMemberParams,
  SetRegulationStatusDto,
  SetRegulationCompliancyDto,
  RegulationStatusParams,
  VersionRegulationStatusParams
} from '@app/common/dto/project-management';
import { RpcPayload } from '@app/common/microservice-client';
import * as fs from 'fs';
import { AuthUser } from './utils/auth-user.decorator';
import { MemberInProject } from './decorators/member-in-project.decorator';
import { RoleInProject } from '@app/common/database/entities';
import { RegulationService } from './regulation.service';

@Controller()
export class ProjectManagementController {
  private readonly logger = new Logger(ProjectManagementController.name);

  constructor(
    private readonly projectManagementService: ProjectManagementService,
    private readonly regulationService: RegulationService
  ) { }


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

  // regulations

  @MessagePattern(ProjectManagementTopics.GET_REGULATION_TYPES)
  getRegulationTypes(){
    return this.regulationService.getRegulationTypes()
  }

  @MemberInProject()
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_REGULATIONS)
  getProjectRegulations(@RpcPayload('projectId') projectId: number){
    return this.regulationService.getProjectRegulations(projectId)
  }

  
  @MemberInProject()
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_REGULATION_BY_ID)
  getRegulationById(@RpcPayload() params: RegulationParams){
    return this.regulationService.getRegulationById(params)
  }

  @MemberInProject(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.CREATE_PROJECT_REGULATION)
  createRegulation(@RpcPayload() regulation: CreateRegulationDto){
    return this.regulationService.createRegulation(regulation)
  }

  @MemberInProject(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.UPDATE_PROJECT_REGULATION)
  updateRegulation(@RpcPayload() regulation: UpdateRegulationDto){
    return this.regulationService.updateRegulation(regulation)
  }

  @MemberInProject(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.DELETE_PROJECT_REGULATION)
  deleteRegulation(@RpcPayload() params: RegulationParams){
    return this.regulationService.deleteRegulation(params)
  }

  @MemberInProject()
  @MessagePattern(ProjectManagementTopics.SET_VERSION_REGULATION_STATUS)
  setRegulationStatus(@RpcPayload() dto: SetRegulationStatusDto){
    return this.regulationService.setRegulationStatus(dto)
  }

  @MemberInProject(RoleInProject.PROJECT_OWNER)
  @MessagePattern(ProjectManagementTopics.SET_VERSION_REGULATION_COMPLIANCE)
  setComplianceStatus(@RpcPayload() dto: SetRegulationCompliancyDto){
    return this.regulationService.setComplianceStatus(dto)
  }

  @MemberInProject()
  @MessagePattern(ProjectManagementTopics.GET_VERSION_REGULATION_STATUS_BY_ID)
  getVersionRegulationStatus(@RpcPayload() params: RegulationStatusParams){
    return this.regulationService.getVersionRegulationStatus(params)
  }

  @MemberInProject()
  @MessagePattern(ProjectManagementTopics.GET_VERSION_REGULATIONS_STATUSES)
  getVersionRegulationsStatuses(@RpcPayload() dto: VersionRegulationStatusParams){
    return this.regulationService.getVersionRegulationsStatuses(dto)
    
  }

  @MemberInProject()
  @MessagePattern(ProjectManagementTopics.DELETE_VERSION_REGULATION_STATUS)
  deleteVersionRegulationStatus(@RpcPayload() params: RegulationStatusParams){
    return this.regulationService.deleteVersionRegulationStatus(params)
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
