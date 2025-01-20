import { ProjectManagementTopics } from '@app/common/microservice-client/topics';
import { Controller, Logger, UseInterceptors } from '@nestjs/common';
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
  ProjectDto,
  ProjectIdentifierParams,
  SearchProjectsQueryDto,
  GetProjectsQueryDto,
  CreateProjectTokenDto,
  TokenParams,
  UpdateProjectTokenDto,
  DetailedProjectDto,
  EditProjectDto,
  ProjectMemberPreferencesDto,
} from '@app/common/dto/project-management';
import { RpcPayload, UserContextInterceptor } from '@app/common/microservice-client';
import * as fs from 'fs';
import { AuthUser } from './utils/auth-user.decorator';
import { RoleInProject } from '@app/common/database/entities';
import { RegulationService } from './regulation.service';
import { UserSearchDto } from '@app/common/oidc/oidc.interface';
import { ValidateProjectAnyAccess, ValidateProjectTokenAccess, ValidateProjectUserAccess } from '@app/common/utils/project-access';
import { Validate } from 'class-validator';

@Controller()
@UseInterceptors(UserContextInterceptor)
export class ProjectManagementController {
  private readonly logger = new Logger(ProjectManagementController.name);

  constructor(
    private readonly projectManagementService: ProjectManagementService,
    private readonly regulationService: RegulationService
  ) { }

  @MessagePattern(ProjectManagementTopics.GET_USERS)
  getAllUsers(@RpcPayload() params: UserSearchDto) {
    return this.projectManagementService.getUsers(params);
  }

  @MessagePattern(ProjectManagementTopics.GET_PROJECTS)
  getProjects(@RpcPayload() query: GetProjectsQueryDto, @AuthUser('email') email: string) {
    return this.projectManagementService.getProjects(query, email);
  }

  @MessagePattern(ProjectManagementTopics.SEARCH_PROJECTS)
  searchProjects(@RpcPayload() query: SearchProjectsQueryDto, @AuthUser('email') email: string) {
    return this.projectManagementService.searchProjects(query, email);
  }
  @MessagePattern(ProjectManagementTopics.CREATE_PROJECT)
  createProject(@RpcPayload() project: CreateProjectDto) {
    return this.projectManagementService.createProject(project);
  }

  @ValidateProjectUserAccess(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.EDIT_PROJECT)
  editProject(@RpcPayload() project: EditProjectDto) {
    return this.projectManagementService.editProject(project);
  }

  @ValidateProjectUserAccess(RoleInProject.PROJECT_OWNER)
  @MessagePattern(ProjectManagementTopics.DELETE_PROJECT)
  deleteProject(@RpcPayload() params: ProjectIdentifierParams) {
    return this.projectManagementService.deleteProject(params);
  }

  @ValidateProjectUserAccess(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.ADD_PROJECT_NEW_MEMBER)
  addMemberToProject(@RpcPayload() projectMember: AddMemberToProjectDto) {
    return this.projectManagementService.addMemberToProject(projectMember);
  }

  @ValidateProjectUserAccess(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.REMOVE_PROJECT_MEMBER)
  removeMemberFromProject(@RpcPayload() params: ProjectMemberParams, @AuthUser("email") authEmail: string) {
    return this.projectManagementService.removeMemberFromProject(params, authEmail);
  }

  @MessagePattern(ProjectManagementTopics.CONFIRM_PROJECT_MEMBER)
  confirmMemberInProject(@RpcPayload() params: ProjectIdentifierParams, @AuthUser("email") authEmail: string) {
    return this.projectManagementService.confirmMemberInProject(params, authEmail);
  }

  @ValidateProjectUserAccess(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.EDIT_PROJECT_MEMBER)
  editProjectMember(@RpcPayload() projectMember: EditProjectMemberDto): Promise<MemberResDto> {
    return this.projectManagementService.editProjectMember(projectMember);
  }

  @ValidateProjectUserAccess()
  @MessagePattern(ProjectManagementTopics.GET_MEMBER_PROJECT_PREFERENCES)
  getMemberProjectPreferences(@RpcPayload() params: ProjectIdentifierParams, @AuthUser("email") authEmail: string) {
    return this.projectManagementService.getMemberProjectPreferences(params, authEmail);

  }
  @ValidateProjectUserAccess()
  @MessagePattern(ProjectManagementTopics.UPDATE_MEMBER_PROJECT_PREFERENCES)
  updateMemberProjectPreferences(@RpcPayload() dto: ProjectMemberPreferencesDto, @AuthUser("email") authEmail: string) {
    return this.projectManagementService.updateMemberProjectPreferences(dto, authEmail);
  }

  @MessagePattern(ProjectManagementTopics.GET_USER_PROJECTS)
  getUserProjects(@RpcPayload("stringValue") email: string): Promise<MemberProjectsResDto> {
    return this.projectManagementService.getUserProjects(email);
  }

  @ValidateProjectUserAccess()
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_BY_IDENTIFIER)
  getProject(@RpcPayload() params: ProjectIdentifierParams, @AuthUser("email") authEmail: string): Promise<DetailedProjectDto> {
    return this.projectManagementService.getProject(params, authEmail);
  }


  @ValidateProjectUserAccess()
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_RELEASES)
  getProjectReleases(@RpcPayload('projectId') projectId: number) {
    return this.projectManagementService.getProjectReleases(projectId);
  }

  @MessagePattern(ProjectManagementTopics.GET_DEVICES_BY_CATALOG_ID)
  getDevicesByCatalogId(@RpcPayload("stringValue") catalogId: string): Promise<DeviceResDto[]> {
    return this.projectManagementService.getDevicesByCatalogId(catalogId);
  }

  @MessagePattern(ProjectManagementTopics.GET_DEVICES_BY_PROJECT)
  getDevicesByProject(@RpcPayload() projectId: number): Promise<DeviceResDto[]> {
    return this.projectManagementService.getDevicesByProject(projectId);
  }

  @MessagePattern(ProjectManagementTopics.GET_DEVICES_BY_PLATFORM)
  getDevicesByPlatform(@RpcPayload("stringValue") platform: string): Promise<DeviceResDto[]> {
    return this.projectManagementService.getDevicesByPlatform(platform);
  }

  // regulations

  @MessagePattern(ProjectManagementTopics.GET_REGULATION_TYPES)
  getRegulationTypes() {
    return this.regulationService.getRegulationTypes()
  }

  @ValidateProjectAnyAccess()
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_REGULATIONS)
  getProjectRegulations(@RpcPayload('projectId') projectId: number) {
    return this.regulationService.getProjectRegulations(projectId)
  }

  @ValidateProjectAnyAccess()
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_REGULATION_BY_ID)
  getRegulationById(@RpcPayload() params: RegulationParams) {
    return this.regulationService.getRegulationById(params)
  }

  @ValidateProjectUserAccess(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.CREATE_PROJECT_REGULATION)
  createRegulation(@RpcPayload() regulation: CreateRegulationDto) {
    return this.regulationService.createRegulation(regulation)
  }

  @ValidateProjectUserAccess(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.UPDATE_PROJECT_REGULATION)
  updateRegulation(@RpcPayload() regulation: UpdateRegulationDto) {
    return this.regulationService.updateRegulation(regulation)
  }

  @ValidateProjectUserAccess(RoleInProject.PROJECT_OWNER, RoleInProject.PROJECT_ADMIN)
  @MessagePattern(ProjectManagementTopics.DELETE_PROJECT_REGULATION)
  deleteRegulation(@RpcPayload() params: RegulationParams) {
    return this.regulationService.deleteRegulation(params)
  }

  // PROJECT TOKEN

  @ValidateProjectUserAccess()
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_TOKENS)
  getProjectTokens(@RpcPayload() params: ProjectIdentifierParams) {
    return this.projectManagementService.getProjectTokens(params.projectId)
  }

  @ValidateProjectUserAccess()
  @MessagePattern(ProjectManagementTopics.GET_PROJECT_TOKEN_BY_ID)
  getProjectTokenById(@RpcPayload() params: TokenParams) {
    return this.projectManagementService.getProjectTokenById(params)
  }

  @ValidateProjectUserAccess()
  @MessagePattern(ProjectManagementTopics.CREATE_PROJECT_TOKEN)
  createProjectToken(@RpcPayload() dto: CreateProjectTokenDto) {
    return this.projectManagementService.createToken(dto)
  }

  @ValidateProjectUserAccess()
  @MessagePattern(ProjectManagementTopics.UPDATE_PROJECT_TOKEN)
  updateProjectToken(@RpcPayload() dto: UpdateProjectTokenDto) {
    return this.projectManagementService.updateProjectToken(dto)
  }

  @ValidateProjectUserAccess()
  @MessagePattern(ProjectManagementTopics.DELETE_PROJECT_TOKEN)
  deleteProjectToken(@RpcPayload() params: TokenParams) {
    return this.projectManagementService.deleteProjectToken(params)
  }

  @MessagePattern(ProjectManagementTopics.CHECK_HEALTH)
  healthCheckSuccess() {
    const version = this.readImageVersion()
    this.logger.log(`Device service - Health checking, Version: ${version}`)
    return "Project-Management is running successfully. Version: " + version
  }

  private readImageVersion() {
    let version = 'unknown'
    try {
      version = fs.readFileSync('NEW_TAG.txt', 'utf8');
    } catch (error) {
      this.logger.error(`Unable to read image version - error: ${error}`)
    }
    return version
  }
}
