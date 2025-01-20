import { MemberProjectEntity, MemberEntity, ProjectEntity, RoleInProject, UploadVersionEntity, DeviceEntity, DiscoveryMessageEntity, MemberProjectStatusEnum, ProjectTokenEntity } from '@app/common/database/entities';
import { ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike, In } from 'typeorm';
import { AddMemberToProjectDto, EditProjectMemberDto, ProjectMemberParams } from '@app/common/dto/project-management/dto/project-member.dto';
import {
  DeviceResDto, ProjectReleasesDto, ProjectTokenDto,
  MemberProjectsResDto, MemberResDto, ProjectDto,
  CreateProjectDto,
  ProjectIdentifierParams,
  GetProjectsQueryDto,
  SearchProjectsQueryDto,
  BaseProjectDto,
  TokenParams,
  CreateProjectTokenDto,
  UpdateProjectTokenDto,
  DetailedProjectDto
} from '@app/common/dto/project-management';
import { OidcService, UserSearchDto } from '@app/common/oidc/oidc.interface';
import { PaginatedResultDto } from '@app/common/dto/pagination.dto';
import { ProjectAccessService } from '@app/common/utils/project-access';


@Injectable()
export class ProjectManagementService implements ProjectAccessService{
  
  private readonly logger = new Logger(ProjectManagementService.name);
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(UploadVersionEntity) private readonly uploadVersionRepo: Repository<UploadVersionEntity>,
    @InjectRepository(MemberProjectEntity) private readonly memberProjectRepo: Repository<MemberProjectEntity>,
    @InjectRepository(MemberEntity) private readonly memberRepo: Repository<MemberEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(ProjectTokenEntity) private readonly tokenRepo: Repository<ProjectTokenEntity>,
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
  
  getMemberInProject(projectId: number, email: string): Promise<MemberProjectEntity>;
  getMemberInProject(projectName: string, email: string): Promise<MemberProjectEntity>;
  getMemberInProject(projectIdentifier: string | number, email: string): Promise<MemberProjectEntity> {
    this.logger.log(`Get member in project with email: ${email} and project-identifier: ${projectIdentifier}`)
    const projectCondition = this.findProjectCondition(projectIdentifier);

    return this.memberProjectRepo.findOne({
      relations: ['project', 'member'],
      where: {
        project: projectCondition,
        member: { email: email }
      }
    });
  }

  async getProjectFromToken(token: string): Promise<ProjectEntity> {
    const payload = this.jwtService.verify(token)
    const project = await this.projectRepo.findOne({ where: { id: payload.data.projectId, tokens: { token: token, isActive: true } } })
    if (!project) {
      throw new ForbiddenException('Not Allowed in this project');
    }
    
    return project;
  }


  // TODO pinned and includePinned not implemented
  async getProjects(query: GetProjectsQueryDto, email: string): Promise<PaginatedResultDto<ProjectDto>> {
    this.logger.debug(`Get projects with query: ${JSON.stringify(query)}`)
    const { page = 1 , perPage = 10, pinned, includePinned } = query;
    
    const [projectsId, count] = await this.projectRepo.findAndCount({
      select: {id: true},
      where: {
        memberProject: {member: {email: email}},
      }
    });

    const projectsEntities = await this.projectRepo.find({
      select: {memberProject: true, releases: {catalogId: true}},
      where: {
        id: In(projectsId.map(project => project.id))
      },
      relations: {memberProject: {member: true}, releases: true},
      skip: (page - 1) * perPage,
      take: perPage,
    })
    
    const projects = projectsEntities.map(project => new ProjectDto().fromProjectEntity(project));

    return {
      data: projects,
      total: count,
      perPage: perPage,
      page: page,
    }

  }

  // TODO status not implemented
  async searchProjects(dto: SearchProjectsQueryDto, email: string): Promise<PaginatedResultDto<BaseProjectDto>> {
    this.logger.debug(`Search projects with query: ${JSON.stringify(dto)}`)
    const { page = 1 , perPage = 10, query, status} = dto;

    const [projectsEntities, count] = await this.projectRepo.findAndCount({
      where: {
        memberProject: {member: {email: email}},
        name: ILike(`%${query}%`),
      },
      skip: (page - 1) * perPage,
      take: perPage,
    })
    
    const project = projectsEntities.map(project => new BaseProjectDto().fromProjectEntity(project));

    return {
      data: project,
      total: count,
      perPage: perPage,
      page: page,
    }
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

  async confirmMemberInProject(params: ProjectIdentifierParams, email: string) {
    this.logger.debug(`Confirm member in project with email: ${email} and projectId: ${params.projectId}`)
    const member = await this.getOrCreateMember(email, false);
    const memberProject = await this.getMemberInProject(params.projectId, member.email);
    if (!memberProject) {
      throw new NotFoundException(`Member with email ${email} not found in project with id ${params.projectId}`);
    }

    memberProject.status = MemberProjectStatusEnum.ACTIVE;
    await this.memberProjectRepo.save(memberProject);

    return await this.getProjectEntity(params.projectId);
  }

  async addMemberToProject(projectMember: AddMemberToProjectDto): Promise<MemberResDto> {
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
    return new MemberResDto().fromMemberEntity(member, mp.role, mp.status)
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
        let prj = new DetailedProjectDto()
        prj.id = projectId;
        prj.name = memberProject.project_name;
        prj.description = memberProject.project_description;
        // prj.tokens = tokens != null ? tokens.split(',') : undefined
        prj.members = [];

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

  async getProject(params: ProjectIdentifierParams): Promise<DetailedProjectDto> { 
    const project = await this.projectRepo.findOne({
      where: {id: params.projectId},
      relations: {memberProject: {member: true}, tokens: true},
    });

    if (!project) {
      throw new NotFoundException(`Project: '${params.projectId}' not found`);
    }

    return new DetailedProjectDto().fromProjectEntity(project);
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


  async getProjectTokens(projectId: number): Promise<ProjectTokenDto[]>{
    this.logger.log(`Get all tokens for project with id ${projectId}`);
    const tokens = await this.tokenRepo.find({where: { project: { id: projectId } }})
    return tokens.map(t => ProjectTokenDto.fromProjectTokenEntity(t))
  }

  async getProjectTokenById(params: TokenParams): Promise<ProjectTokenDto> {
    this.logger.log(`Get token with id ${params.tokenId} for project with id ${params.projectId}`);
    const token = await this.tokenRepo.findOne({ where: { id: params.tokenId, project: { id: params.projectId } } })
    if (!token) {
      throw new NotFoundException(`Token with id ${params.tokenId} for project with id ${params.projectId} not found`)
    }
    return ProjectTokenDto.fromProjectTokenEntity(token)
  }

  async createToken(dto: CreateProjectTokenDto): Promise<ProjectTokenDto> {
    this.logger.log(`Create token for project with id ${dto.projectId}`);
    let project = await this.getProjectEntity(dto.projectId);

    const expirationDate = dto?.expirationDate ? new Date(dto?.expirationDate) : null;
    const token = this.generateToken(
      dto.projectId,
      project.name,
      dto.name,
      dto.neverExpires ?? false,
      expirationDate
    );

    this.logger.log(`Generated Token: ${token.slice(token.length - 10)}`);

    const yearFromNow = new Date();
    yearFromNow.setFullYear(yearFromNow.getFullYear() + 1);

    const projectToken = new ProjectTokenEntity();
    projectToken.token = token;
    projectToken.name = dto.name;
    projectToken.neverExpires = dto.neverExpires ?? false;
    projectToken.expirationDate = dto.neverExpires ? null : dto?.expirationDate ?? yearFromNow;
    projectToken.project = project;
    try {
      const savedProjectToken = await this.tokenRepo.save(projectToken);
      return ProjectTokenDto.fromProjectTokenEntity(savedProjectToken);
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }

  async updateProjectToken(dto: UpdateProjectTokenDto): Promise<ProjectTokenDto> {
    this.logger.log(`Update token with id ${dto.id} for project with id ${dto.projectId}`);
    const token = await this.tokenRepo.findOne({ where: { id: dto.id, project: { id: dto.projectId } } })
    if (!token) {
      throw new NotFoundException(`Token with id ${dto.id} for project with id ${dto.projectId} not found`)
    }
    token.name = dto.name;
    token.isActive = dto.isActive;
    try {
      const savedProjectToken = await this.tokenRepo.save(token);
      return ProjectTokenDto.fromProjectTokenEntity(savedProjectToken);
    } catch (error) {
      throw new InternalServerErrorException(error);
    }
  }


  async deleteProjectToken(params: TokenParams): Promise<string> {
    this.logger.log(`Delete token with id ${params.tokenId} for project with id ${params.projectId}`);
    const {raw, affected} = await this.tokenRepo.delete({ id: params.tokenId, project: { id: params.projectId } })
    if (affected === 0) {
      throw new NotFoundException(`Token with id ${params.tokenId} for project with id ${params.projectId} not found`)
    }
    return "Token deleted successfully"
  }
  

  private generateToken(projectId: number, projectName: string, name: string, neverExpires: boolean, expirationDate?: Date): string {
    this.logger.log(`Generate token for project with id ${projectId}`);
    const payload = {projectId, projectName, name, neverExpires}
    const expiresIn = neverExpires ? '100y' : Math.floor((expirationDate.getTime() - Date.now()) / 1000)
    return this.jwtService.sign({ data: payload}, {expiresIn: expiresIn});
  }


}
