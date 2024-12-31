import { MemberProjectEntity, MemberEntity, ProjectEntity, RoleInProject, UploadVersionEntity, DeviceEntity, DiscoveryMessageEntity, RegulationEntity, RegulationTypeEntity, RegulationStatusEntity } from '@app/common/database/entities';
import { ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AddMemberToProjectDto, EditProjectMemberDto, ProjectMemberParams } from '@app/common/dto/project-management/dto/project-member.dto';
import {
  DeviceResDto, ProjectReleasesDto, ProjectTokenDto,
  MemberProjectResDto, MemberProjectsResDto, MemberResDto, ProjectDto,
  CreateProjectDto,
  RegulationTypeDto,
  RegulationDto,
  CreateRegulationDto,
  UpdateRegulationDto,
  RegulationParams,
  RegulationStatusDto,
  SetRegulationCompliancyDto,
  SetRegulationStatusDto,
  RegulationStatusParams,
  VersionRegulationStatusParams
} from '@app/common/dto/project-management';
import { OidcService } from '@app/common/oidc/oidc.interface';


@Injectable()
export class ProjectManagementService {

  private readonly logger = new Logger(ProjectManagementService.name);
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(UploadVersionEntity) private readonly uploadVersionRepo: Repository<UploadVersionEntity>,
    @InjectRepository(MemberProjectEntity) private readonly memberProjectRepo: Repository<MemberProjectEntity>,
    @InjectRepository(MemberEntity) private readonly memberRepo: Repository<MemberEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(DeviceEntity) private readonly deviceRepo: Repository<DeviceEntity>,
    @InjectRepository(RegulationEntity) private readonly regulationRepo: Repository<RegulationEntity>,
    @InjectRepository(RegulationTypeEntity) private readonly regulationTypeRepo: Repository<RegulationTypeEntity>,
    @InjectRepository(RegulationStatusEntity) private readonly regulationStatusRepo: Repository<RegulationStatusEntity>,
    @Inject("OidcProviderService") private readonly oidcService: OidcService
  ) { }

  getMemberInProjectByEmail(projectId: number, email: string) {
    this.logger.debug(`Get member in project with email: ${email} and projectId: ${projectId}`)
    return this.memberProjectRepo.findOne({
      relations: ['project', 'member'],
      where: {
        project: { id: projectId },
        member: { email: email }
      }
    });
  }

  private async getOrCreateMember(email: string): Promise<MemberEntity> {

    try {
      let member = await this.memberRepo.findOne({ where: { email: email } })
      if (!member) {
        this.logger.debug("User is not exist, create him.");
        member = new MemberEntity()
        member.email = email;

        const user = await this.oidcService.getUsers({ email: email, exact: true });
        if (user && user[0]) {
          member.firstName = user[0].firstName;
          member.lastName = user[0].lastName;
        } else {
          this.oidcService.inviteUser({ email });
        }
        member = await this.memberRepo.save(member);
      }
      return member;
    } catch (error) {
      this.logger.error(`Error while getting or creating member: ${error}`);
      throw error;
    }
  }

  // TODO use guard to verify user is a project-admin instead of this method
  private async isProjectAdmin(email: string, projectId: number) {
    const memberProject = await this.memberProjectRepo
      .findOne({
        relations: ['project', 'member'],
        where: {
          project: {
            id: projectId
          },
          member: {
            email: email
          },
          role: In([RoleInProject.PROJECT_ADMIN, RoleInProject.PROJECT_OWNER])
        }
      })

    if (!memberProject) {
      const errorMes = `Project: ${projectId} doesn't exist or User: ${email} is Not allowed to add members to this Project`
      this.logger.debug(errorMes)
      throw new HttpException(errorMes, HttpStatus.FORBIDDEN);

    }
    this.logger.debug(memberProject);

    return memberProject
  }

  async createProject(projectDto: CreateProjectDto) {
    this.logger.debug(`Create project: ${projectDto.name}`)

    let project = new ProjectEntity();
    project.name = projectDto.name;
    project.description = projectDto.description;

    try {
      project = await this.projectRepo.save(project);
    } catch (error) {
      this.logger.error(`Error while saving project: ${error}`);
      if (error.code === '23505') { // Unique constraint violation error code for PostgreSQL
        throw new ConflictException('Project name already exists');
      }
      throw error;
    }

    let member = await this.getOrCreateMember(projectDto.username);
    this.logger.debug(`Member: ${member}`)

    let mp = new MemberProjectEntity();
    mp.member = member;
    mp.project = project;
    mp.role = RoleInProject.PROJECT_OWNER;

    mp = await this.memberProjectRepo.save(mp);
    this.logger.debug(`MemberProject: ${mp}`)

    return new ProjectDto().fromProjectEntity(project)
  }



  async addMemberToProject(projectMember: AddMemberToProjectDto): Promise<MemberProjectResDto> {
    this.logger.debug(`Add member to project: ${projectMember.email}`)

    let member = await this.getOrCreateMember(projectMember.email);
    this.logger.debug(`Member: ${member}`)

    let project = await this.getProject(projectMember.projectId);
    this.logger.debug(`Project: ${project}`)

    let mp = new MemberProjectEntity();
    mp.member = member;
    mp.project = project;
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

  private async getProject(projectId: number): Promise<ProjectEntity> {
    let project = await this.projectRepo.findOne({ where: { id: projectId } })
    if (!project) {
      throw new NotFoundException(`Project with id ${projectId} not found`);
    }
    return project;
  }

  private async getMember(memberId: number): Promise<MemberEntity> {
    let member = await this.memberRepo.findOneBy({ id: memberId })
    if (!member) {
      throw new NotFoundException(`Member with id ${memberId} not found`);
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
      .leftJoinAndSelect('member_project.project', 'project')
      .leftJoinAndSelect('project.regulations', 'regulation')
      .leftJoinAndSelect('member_project.member', 'member')
      .where(`member_project.projectId IN (${subQuery})`)

    const res = await query.getRawMany();

    // map result to objects
    const groupedResult = res.reduce((acc, memberProject) => {
      const projectId = memberProject.project_id;

      let tokens: string = memberProject.project_tokens

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
    }, { member: null, projects: {} });


    let mbProjectsRes = new MemberProjectsResDto()
    mbProjectsRes.projects = Object.values(groupedResult.projects);
    mbProjectsRes.member = groupedResult.member;
    return mbProjectsRes;
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
    let project = await this.getProject(projectId);

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


  getRegulationTypes(): Promise<RegulationTypeDto[]> {
    this.logger.log('Get all regulation types');
    return this.regulationTypeRepo.find();
  }

  async getProjectRegulations(projectId: number): Promise<RegulationDto[]> {
    this.logger.log(`Get all regulations for project with id ${projectId}`);
    return this.regulationRepo.find({
      where: {
        project: { id: projectId }
      },
      relations: { project: true },
      select: { project: { id: true } },
      order: { order: 'ASC' }
    }).then(regulation => regulation.map(r => new RegulationDto().fromRegulationEntity(r)));
  }

  async createRegulation(regulation: CreateRegulationDto): Promise<RegulationDto> {
    this.logger.log('Create regulation');

    const regulationType = await this.regulationTypeRepo.findOne({ where: { id: regulation.typeId } });
    if (!regulationType) {
      throw new NotFoundException(`Regulation type with id ${regulation.typeId} not found`);
    }

    const project = await this.projectRepo.findOne({ where: { id: regulation.projectId } });
    if (!project) {
      throw new NotFoundException(`Project with id ${regulation.projectId} not found`);
    }

    const newRegulation = new RegulationEntity();
    newRegulation.name = regulation.name;
    newRegulation.description = regulation.description;
    newRegulation.config = regulation.config;
    newRegulation.order = regulation.order;
    newRegulation.type = regulationType;
    newRegulation.project = project;

    return this.regulationRepo.save(newRegulation).then(r => new RegulationDto().fromRegulationEntity(r));
  }

  async updateRegulation(regulation: UpdateRegulationDto): Promise<RegulationDto> {
    this.logger.log('Update regulation');

    const currentRegulation = await this.regulationRepo.findOne({ where: { id: regulation.regulationId, project: { id: regulation.projectId } } });
    if (!currentRegulation) {
      throw new NotFoundException(`Regulation with ID ${regulation.regulationId} for Project ID ${regulation.projectId} not found`);
    }

    const regulationEntity = new RegulationEntity();
    regulationEntity.name = regulation?.name;
    regulationEntity.description = regulation?.description;
    regulationEntity.config = regulation?.config;
    regulationEntity.order = regulation?.order;
    if (regulation?.typeId) {
      const regulationType = await this.regulationTypeRepo.findOne({ where: { id: regulation.typeId } });
      if (!regulationType) {
        throw new NotFoundException(`Regulation type with id ${regulation.typeId} not found`);
      }
      regulationEntity.type = regulationType;
    }

    return this.regulationRepo.save({ ...currentRegulation, ...regulationEntity }).then(r => new RegulationDto().fromRegulationEntity(r));
  }


  async getRegulationById(params: RegulationParams): Promise<RegulationDto> {
    this.logger.log('Get regulation by id');
    const regulation = await this.regulationRepo.findOne({ where: { id: params.regulationId, project: { id: params.projectId } }, relations: { project: true }, select: { project: { id: true } } });
    if (!regulation) {
      throw new NotFoundException(`Regulation with ID ${params.regulationId} for Project ID ${params.projectId} not found`);
    }
    return new RegulationDto().fromRegulationEntity(regulation);
  }

  async deleteRegulation(params: RegulationParams): Promise<string> {
    this.logger.log('Delete regulation');

    let { raw, affected } = await this.regulationRepo.delete({ id: params.regulationId, project: { id: params.projectId } });
    if (affected == 0) {
      throw new NotFoundException(`Regulation with ID ${params.regulationId} for Project ID ${params.projectId} not found`);
    }
    return 'Regulation deleted';
  }


  private async getRegulationAndVersion(regulationId: number, versionId: string, projectId: number): Promise<{regulation: RegulationEntity, version: UploadVersionEntity}> {
    this.logger.debug(`Get regulation and version by regulationId: ${regulationId} and versionId: ${versionId}`);
    const [regulation, version] = await Promise.all([
      this.regulationRepo.findOne({where: {id: regulationId, project: {id: projectId}}}),
      this.uploadVersionRepo.findOne({ where: { catalogId: versionId, project: { id: projectId } } })
    ]);
    if (!version) {
      throw new NotFoundException(`Version with ID ${versionId} not found`);
    }
    if (!regulation) {
      throw new NotFoundException(`Regulation with ID ${regulationId} for Project ID ${projectId} not found`);
    }

    return {regulation, version};
  }
  

  async setRegulationStatus(dto: SetRegulationStatusDto): Promise<RegulationStatusDto> {
    this.logger.log('Set regulation status');

    const {regulation, version} = await this.getRegulationAndVersion(dto.regulationId, dto.versionId, dto.projectId);

    await this.regulationStatusRepo
      .createQueryBuilder()
      .insert()
      .values({
        value: dto.value,
        reportDetails: dto.reportDetails,
        version: version,
        regulation: regulation
      })
      .orUpdate(
        ['value', 'reportDetails'],
        "regulation_version_unique_constraint",
       )
      .execute();
          
  
    // TODO validate compliance
    return this.getVersionRegulationStatus(dto as RegulationStatusParams);
  }


  async setComplianceStatus(dto: SetRegulationCompliancyDto): Promise<RegulationStatusDto> {
    this.logger.log('Set compliance status');
    const {regulation, version} = await this.getRegulationAndVersion(dto.regulationId, dto.versionId, dto.projectId);
  
    const res = await this.regulationStatusRepo
      .createQueryBuilder()
      .insert()
      .values({
        isCompliant: dto.isCompliant,
        version: version,
        regulation: regulation
      })
      .orUpdate(
        ['isCompliant'],
        "regulation_version_unique_constraint",
      )
      .execute();
    

    return this.getVersionRegulationStatus(dto as RegulationStatusParams);
  }

  async getVersionRegulationStatus(params: RegulationStatusParams): Promise<RegulationStatusDto> {
    this.logger.debug('Get regulation status');
    const regulationStatus = await this.regulationStatusRepo.findOne({ 
      select: {version: {catalogId: true}, regulation: {id: true, project: {id: true}}},
      relations: {version: true, regulation: {project: true}},
      where: { 
        version: {catalogId: params.versionId},
        regulation: { 
          id: params.regulationId, 
          project: {id: params.projectId} 
        }, 
      },
    });

    if (!regulationStatus) {
      throw new NotFoundException(`Regulation status with regulationId ${params.regulationId} for Project ID ${params.projectId} not found`);
    }
    return new RegulationStatusDto().fromRegulationStatusEntity(regulationStatus);
  }

  async getVersionRegulationsStatuses(params: VersionRegulationStatusParams): Promise<RegulationStatusDto[]> {
    this.logger.log(`Get regulation statuses for project id ${params.projectId} and version id ${params.versionId}`);

    const regulationStatuses = await this.regulationStatusRepo.find({ 
      select: {version: {catalogId: true}, regulation: {id: true, project: {id: true}}},
      relations: {version: true, regulation: {project: true}},
      where: { 
        version: {catalogId: params.versionId},
        regulation: { 
          project: {id: params.projectId} }, 
        },
      order: {regulation: {order: 'ASC'}} 
      });

    this.logger.debug(`Regulations status found: ${regulationStatuses.length}`);
    return regulationStatuses.map(rs => new RegulationStatusDto().fromRegulationStatusEntity(rs));
  }


  async deleteVersionRegulationStatus(params: RegulationStatusParams) {
    this.logger.log(`Delete regulation status with regulationId ${params.regulationId} for Project ID ${params.projectId} and versionId ${params.versionId}`);

    let { raw, affected } = await this.regulationStatusRepo.delete({
      regulation: { id: params.regulationId },
      version: { catalogId: params.versionId }
    });
    this.logger.debug(`Regulation status deleted: ${raw}, affected: ${affected}`);

    if (affected == 0) {
      throw new NotFoundException(`Regulation status with regulationId ${params.regulationId} for Project ID ${params.projectId} and versionId ${params.versionId} not found`);
    }
    return "Regulation status deleted";
  }

}
