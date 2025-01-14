import { MemberProjectEntity, MemberEntity, ProjectEntity, RoleInProject, UploadVersionEntity, DeviceEntity, DiscoveryMessageEntity, MemberProjectStatusEnum } from '@app/common/database/entities';
import { ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AddMemberToProjectDto, EditProjectMemberDto, ProjectMemberParams } from '@app/common/dto/project-management/dto/project-member.dto';
import {
  DeviceResDto, ProjectReleasesDto, ProjectTokenDto,
  MemberProjectResDto, MemberProjectsResDto, MemberResDto, ProjectDto,
  CreateProjectDto,
  ProjectIdentifierParams
} from '@app/common/dto/project-management';
import { OidcService, UserSearchDto } from '@app/common/oidc/oidc.interface';


@Injectable()
export class ProjectManagementService{
  
  private readonly logger = new Logger(ProjectManagementService.name);
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(UploadVersionEntity) private readonly uploadVersionRepo: Repository<UploadVersionEntity>,
    @InjectRepository(MemberProjectEntity) private readonly memberProjectRepo: Repository<MemberProjectEntity>,
    @InjectRepository(MemberEntity) private readonly memberRepo: Repository<MemberEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(DeviceEntity) private readonly deviceRepo: Repository<DeviceEntity>,
    @Inject("OidcProviderService") private readonly oidcService: OidcService
  ) { }
  
  async getUsers(params: UserSearchDto) {
    return await this.oidcService.getUsers(params)
  }

  private findProjectCondition(projectIdentifier: number | string) {
    return typeof projectIdentifier === 'number'
    ? { id: projectIdentifier }
    : { name: projectIdentifier };
  }
  getMemberInProjectByEmail(projectId: number, email: string): Promise<MemberProjectEntity | null>;
  getMemberInProjectByEmail(projectName: string, email: string): Promise<MemberProjectEntity | null>;

  getMemberInProjectByEmail(projectIdentifier: number | string, email: string) : Promise<MemberProjectEntity | null>{
    this.logger.verbose(`Get member in project with email: ${email} and project-identifier: ${projectIdentifier}`)
    
    const projectCondition = this.findProjectCondition(projectIdentifier);

    return this.memberProjectRepo.findOne({
      relations: ['project', 'member'],
      where: {
        project: projectCondition,
        member: { email: email }
      }
    });
  }

  private async getOrCreateMember(email: string, invite?: boolean): Promise<MemberEntity> {

    try {
      let member = await this.getMemberByEmail(email).catch(error => {
        this.logger.debug(`Member with email ${email} not found, creating new member`);
      });
      if (!member || !member.firstName || !member.lastName) {
        if (!member) {
          member = new MemberEntity()
          member.email = email;
        }

        const user = await this.oidcService.getUsers({ email: email, exact: true });

        if (user && user[0]) {
          member.firstName = user[0].firstName;
          member.lastName = user[0].lastName;
        } else {
          if (invite) {
            this.oidcService.inviteUser({ email });
          } else {
            this.logger.error(`User with email ${email} not found`);
            throw new NotFoundException(`User with email ${email} not found`);
          }
        }
        member = await this.memberRepo.save(member);
      }
      return member;
    } catch (error) {
      this.logger.error(`Error while getting or creating member: ${error}`);
      throw error;
    }
  }


  async createProject(projectDto: CreateProjectDto) {
    this.logger.debug(`Create project: ${projectDto.name}`)

    let project = new ProjectEntity();
    project.name = projectDto.name;
    project.description = projectDto.description;

    let member = await this.getOrCreateMember(projectDto.username, false)

    try {
      project = await this.projectRepo.save(project);
    } catch (error) {
      this.logger.error(`Error while saving project: ${error}`);
      if (error.code === '23505') { // Unique constraint violation error code for PostgreSQL
        throw new ConflictException('Project name already exists');
      }
      throw error;
    }

    this.logger.debug(`Member: ${member}`)

    let mp = new MemberProjectEntity();
    mp.member = member;
    mp.project = project;
    mp.role = RoleInProject.PROJECT_OWNER;

    mp = await this.memberProjectRepo.save(mp);
    this.logger.debug(`MemberProject: ${mp}`)

    return new ProjectDto().fromProjectEntity(project)
  }

  async confirmMemberInProject(projectId: number, email: string) {
    this.logger.debug(`Confirm member in project with email: ${email} and projectId: ${projectId}`)
    const member = await this.getOrCreateMember(email, false);
    const memberProject = await this.getMemberInProjectByEmail(projectId, member.email);
    if (!memberProject) {
      throw new NotFoundException(`Member with email ${email} not found in project with id ${projectId}`);
    }

    memberProject.status = MemberProjectStatusEnum.ACTIVE;
    await this.memberProjectRepo.save(memberProject);

    return await this.getProjectEntity(projectId);
  }

  async addMemberToProject(projectMember: AddMemberToProjectDto): Promise<MemberProjectResDto> {
    this.logger.debug(`Add member to project: ${projectMember.email}`)

    let member = await this.getOrCreateMember(projectMember.email, true).catch(error => {
      this.logger.error(`Failed to add member ${projectMember.email} to project ${projectMember.projectId}, Err: ${error}`);
    });

    if (!member) return;

    this.logger.debug(`Member: ${member}`)

    let project = await this.getProjectEntity(projectMember.projectId);
    this.logger.debug(`Project: ${project}`)

    let mp = await this.memberProjectRepo.findOne({ where: { member: { id: member.id }, project: { id: project.id } } })
    if (!mp) {
      mp = new MemberProjectEntity();
      mp.member = member;
      mp.project = project;
      mp.status = MemberProjectStatusEnum.INVITED;
    } else {
      mp.status = MemberProjectStatusEnum.ACTIVE;
    }

    mp.role = projectMember.role;

    await this.memberProjectRepo.upsert(mp, ["project", "member"]);

    this.logger.debug(`MemberProject: ${mp}`)
    return new MemberProjectResDto().fromMemberProjectEntity(mp)
  }

  async removeMemberFromProject(params: ProjectMemberParams, authEmail: string): Promise<string> {
    this.logger.debug(`Remove member from project: ${params.memberId}, project: ${params.projectId}`)

    const mp = await this.memberProjectRepo.findOne({ relations: ['member'], where: { member: { id: params.memberId }, project: { id: params.projectId } } })

    if (!mp) {
      throw new NotFoundException(`Member with id ${params.memberId} not found in project with id ${params.projectId}`);

    } else if (mp.member.email == authEmail) {
      this.logger.warn("Not allowed to remove yourself");
      throw new HttpException("Not allowed to remove yourself", HttpStatus.FORBIDDEN);

    } else if (mp.role == RoleInProject.PROJECT_OWNER) {
      this.logger.warn("Not allowed to remove project Owner");
      throw new HttpException("Not allowed to remove project Owner", HttpStatus.FORBIDDEN);
    }
    await this.memberProjectRepo.remove(mp);
    return "User was removed!";
  }

  async editProjectMember(projectMember: EditProjectMemberDto): Promise<MemberResDto> {
    this.logger.debug(`Edit member: ${projectMember.memberId}`)

    // TODO is not clear 
    if (projectMember.role == RoleInProject.PROJECT_OWNER) {
      this.logger.warn("Not allowed to set member to Owner");
      throw new HttpException("Not allowed to set member to Owner (Only one Owner Possible)", HttpStatus.FORBIDDEN);
    }

    const mp = await this.memberProjectRepo.findOne({
      relations: ['member'],
      where: { member: { id: projectMember.memberId }, project: { id: projectMember.projectId } }
    })
    if (!mp) {
      throw new NotFoundException(`Member with id ${projectMember.memberId} not found in project with id ${projectMember.projectId}`);
    }

    mp.role = projectMember.role;

    let saved = await this.memberProjectRepo.save(mp);

    return new MemberResDto().fromMemberEntity(mp.member, saved.role);
  }

  private async getMember(memberId: number): Promise<MemberEntity> {
    let member = await this.memberRepo.findOneBy({ id: memberId })
    if (!member) {
      throw new NotFoundException(`Member with id ${memberId} not found`);
    }
    return member;
  }

  private async getMemberByEmail(email: string): Promise<MemberEntity> {
    let member = await this.memberRepo.findOneBy({ email })
    if (!member) {
      throw new NotFoundException(`Member with email ${email} not found`);
    }
    return member;
  }

  // todo get default project
  async getUserProjects(email: string): Promise<MemberProjectsResDto> {
    this.logger.debug(`Get Projects for users: ${email}`)
    const memberProjectBuilder = this.memberProjectRepo.createQueryBuilder("member_project")
    const subQuery = memberProjectBuilder
      .select('member_project.projectId')
      .leftJoin('member_project.member', 'm')
      .where('m.email = :email', { email })
      .getQuery()

    const query = memberProjectBuilder
      .select('member_project.role')
      .select('member_project.status')
      .leftJoinAndSelect('member_project.project', 'project')
      .leftJoinAndSelect('project.regulations', 'regulation')
      .leftJoinAndSelect('member_project.member', 'member')
      .where(`member_project.projectId IN (${subQuery})`)

    const res = await query.getRawMany();

    // map result to objects
    const groupedResult = res.reduce((acc, memberProject) => {
      const projectId = memberProject.project_id;

      let tokens: string = memberProject.project_tokens

      if (memberProject.member_email == email) {
        if (memberProject.member_project_status === MemberProjectStatusEnum.INVITED) {
          acc.invitedProjects.push(projectId)
        } else if (memberProject.member_project_status === MemberProjectStatusEnum.INACTIVE) {
          acc.inactiveProjects.push(projectId)
        }
      }

      if (!acc.projects[projectId]) {
        let prj = new ProjectDto()
        prj.id = projectId;
        prj.name = memberProject.project_name;
        prj.description = memberProject.project_description;
        prj.tokens = tokens != null ? tokens.split(',') : undefined
        prj.members = [];
        prj.regulation = [];

        acc.projects[projectId] = prj
      }

      let mb = new MemberResDto()
      mb.id = memberProject.member_id;
      mb.email = memberProject.member_email;
      mb.firstName = memberProject.member_first_name;
      mb.lastName = memberProject.member_last_name;
      mb.role = memberProject.member_project_role

      if (mb.email != email) {
        acc.projects[projectId].members.push(mb);
      } else if (!acc.member) {
        mb.defaultProject = !memberProject.member_default_project ? undefined : memberProject.member_default_project
        acc.member = mb;
      }

      return acc;
    }, { member: null, projects: {}, invitedProjects: [], inactiveProjects: [] });

    // TODO write test for this
    // imaging active invited and inactive projects
    let mbProjectsRes = new MemberProjectsResDto()
    mbProjectsRes.member = groupedResult.member;
    mbProjectsRes.invitedProjects = groupedResult.invitedProjects.map((id: number) => {
      const pro = groupedResult.projects[id];
      delete groupedResult.projects[id];
      return pro
    })

    groupedResult.inactiveProjects.map((id: number) => {
      delete groupedResult.projects[id];
    })

    mbProjectsRes.projects = Object.values(groupedResult.projects);

    return mbProjectsRes;
  }

  private async getProjectEntity(projectId: number): Promise<ProjectEntity>{
    const project = await this.projectRepo.findOneBy({ id: projectId });
    if (!project) {
      throw new NotFoundException(`Project: ${projectId} not found`);
    }
    return project
  }

  async getProject(params: ProjectIdentifierParams): Promise<ProjectDto> { 
    const project = await this.projectRepo.findOne({
      where: {id: params.projectId},
      relations: {memberProject: {member: true}},
    });

    if (!project) {
      throw new NotFoundException(`Project: '${params.projectId}' not found`);
    }

    return new ProjectDto().fromProjectEntity(project);
  }


  async getDevicesByCatalogId(catalogId: string): Promise<DeviceResDto[]> {
    this.logger.debug('Get devices by catalogId: ' + catalogId)
    let queryBuilder = this.deviceRepo
      .createQueryBuilder('device')
      .leftJoin('device.components', 'component')
      .where('component.catalogId = :catalogId', { catalogId: catalogId });

    let devices = await queryBuilder.getMany()

    return devices.map(dvs => new DeviceResDto().formEntity(dvs));
  }

  async getDevicesByProject(projectId: number): Promise<DeviceResDto[]> {
    const comps = await this.uploadVersionRepo.find({
      select: ['catalogId'],
      where: {
        project: {
          id: projectId
        }
      }
    })
    const catalogsId = comps.map(comp => comp.catalogId);
    let queryBuilder = this.deviceRepo
      .createQueryBuilder('device')
      .leftJoin('device.components', 'component')
      .where('component.catalogId IN (:...catalogsId)', { catalogsId: catalogsId });

    let devices = await queryBuilder.getMany()

    return devices.map(dvs => new DeviceResDto().formEntity(dvs));
  }

  async getDevicesByPlatform(platformName: string): Promise<DeviceResDto[]> {
    const queryBuilder = this.deviceRepo
      .createQueryBuilder('device')
      .leftJoin(DiscoveryMessageEntity, 'dsc_msg', "dsc_msg.deviceID = device.ID")
      .where(`dsc_msg.discoveryData ->'platform'->>'name' = :platformName`, { platformName: platformName })

    let devices = await queryBuilder.getMany()

    return devices.map(dvs => new DeviceResDto().formEntity(dvs));
  }

  async createToken(projectId: number): Promise<ProjectTokenDto> {
    this.logger.log(`Create token for project with id ${projectId}`);
    let project = await this.getProjectEntity(projectId);

    const token = this.generateToken(projectId, project.name);

    this.logger.log(`Generated Token: ${token.projectToken}`)

    if (project.tokens == null) {
      project.tokens = [token.projectToken];
    } else {
      project.tokens.push(token.projectToken);
    }
    this.projectRepo.save(project);
    return token
  }

  private generateToken(projectId: number, projectName: string): ProjectTokenDto {
    const payload = { projectId: projectId, projectName: projectName }

    return { projectToken: this.jwtService.sign({ data: payload }) } as ProjectTokenDto;
  }

  async getProjectReleases(projectId: number): Promise<ProjectReleasesDto[]> {
    this.logger.log(`Get all releases for project with id ${projectId}`);
    let uploadVersions = await this.uploadVersionRepo.find({
      where: {
        project: { id: projectId }
      }
    })

    let projectReleases = uploadVersions.map(uv => {
      return new ProjectReleasesDto().formUploadEntity(uv)
    });

    return projectReleases
  }
}
