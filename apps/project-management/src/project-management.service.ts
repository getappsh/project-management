import { MemberProjectEntity, MemberEntity, ProjectEntity, RoleInProject, UploadVersionEntity, CategoryEntity, FormationEntity, OperationSystemEntity, PlatformEntity, DeviceEntity, DiscoveryMessageEntity } from '@app/common/database/entities';
import { ConflictException, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Entity, In, Repository } from 'typeorm';
import { ProjectDto } from '@app/common/dto/project-management/dto/project.dto';
import { ProjectMemberDto } from '@app/common/dto/project-management/dto/project-member.dto';
import { EditProjectMemberDto } from '@app/common/dto/project-management/dto/edit-project-member.dto';
import {
  ProjectConfigDto, DeviceResDto, ProjectReleasesDto, ProjectTokenDto, ProjectConfigResDto,
  MemberProjectResDto, MemberProjectsResDto, MemberResDto, ProjectResDto
} from '@app/common/dto/project-management';

type configOptionsType = PlatformEntity | FormationEntity | CategoryEntity | OperationSystemEntity

@Injectable()
export class ProjectManagementService {

  private readonly logger = new Logger(ProjectManagementService.name);
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(UploadVersionEntity) private readonly uploadVersionEntity: Repository<UploadVersionEntity>,
    @InjectRepository(CategoryEntity) private readonly categoryEntity: Repository<CategoryEntity>,
    @InjectRepository(FormationEntity) private readonly formationEntity: Repository<FormationEntity>,
    @InjectRepository(OperationSystemEntity) private readonly operationSystemEntity: Repository<OperationSystemEntity>,
    @InjectRepository(PlatformEntity) private readonly platformEntity: Repository<PlatformEntity>,
    @InjectRepository(MemberProjectEntity) private readonly memberProjectRepo: Repository<MemberProjectEntity>,
    @InjectRepository(MemberEntity) private readonly memberRepo: Repository<MemberEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @InjectRepository(DeviceEntity) private readonly deviceRepo: Repository<DeviceEntity>,
  ) { }

  getMemberInProjectByEmail(projectId: number, email: string) {
    return this.memberProjectRepo.findOne({
      relations: ['project', 'member'],
      where: {
        project: { id: projectId },
        member: { email: email }
      }
    });
  }

  private async saveMemberIfNotExist(email: string, firsName: string, lastName: string): Promise<MemberEntity> {
    let member = await this.memberRepo.findOne({ where: { email: email } })
    if (!member) {
      this.logger.debug("User is not exist, create him.");
      member = new MemberEntity()
      member.firstName = firsName;
      member.lastName = lastName;
      member.email = email;

      member = await this.memberRepo.save(member);
    }
    return member;
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

  async getProjectConfigOption(): Promise<ProjectConfigResDto> {
    const platforms = await this.platformEntity.find({ select: ['name'] });
    const formations = await this.formationEntity.find({ select: ['name'] });
    const categories = await this.categoryEntity.find({ select: ['name'] });
    const OS = await this.operationSystemEntity.find({ select: ['name'] });

    return {
      platforms: platforms.map(val => val.name),
      formations: formations.map(val => val.name),
      categories: categories.map(val => val.name),
      operationsSystem: OS.map(val => val.name),
    } as ProjectConfigResDto
  }

  async setProjectConfigOption(configOptions: ProjectConfigDto): Promise<ProjectConfigResDto> {
    const res: ProjectConfigResDto = {} as ProjectConfigResDto

    const entities = {
      platforms: { repo: this.platformEntity, entity: PlatformEntity },
      formations: { repo: this.formationEntity, entity: FormationEntity },
      categories: { repo: this.categoryEntity, entity: CategoryEntity },
      operationsSystem: { repo: this.operationSystemEntity, entity: OperationSystemEntity },
    };

    for (const key in configOptions) {
      const { repo, entity } = entities[key];
      const incomingItems = Array.isArray(configOptions[key]) ? configOptions[key] : [configOptions[key]]
      const itemToSave: configOptionsType[] = []
      for (const item of incomingItems) {
        const itemName = await repo.findOne({ where: { name: item } });
        if (!itemName) {
          this.logger.debug(`Set item ${item} into ${key} `)
          const newItem = new entity();
          newItem.name = item;
          itemToSave.push(newItem);
        }
      }
      const savedItems = (await repo.save(itemToSave)).map(item => item.name)
      res[key] = savedItems
    }
    return res
  }

  async createProject(data: { member: any, project: ProjectDto }) {
    let member = await this.saveMemberIfNotExist(
      data.member.email,
      data.member.given_name,
      data.member.family_name);

    this.logger.debug(member)

    let project = this.projectRepo.create(data.project);

    try {
      project = await this.projectRepo.save(project);
    } catch (error) {
      if (error.code = '23505') {
        this.logger.warn(error);
        throw new ConflictException("Component Name already exist");
      }
    }

    let mp = new MemberProjectEntity();
    mp.member = member;
    mp.project = project;
    mp.role = RoleInProject.PROJECT_OWNER;

    mp = await this.memberProjectRepo.save(mp);
    this.logger.debug(`project saved! ${mp}`)
    return new ProjectResDto().fromProjectEntity(project)
  }

  async addMemberToProject(data: { user: any, projectMember: ProjectMemberDto }): Promise<MemberProjectResDto> {
    const memberProject = await this.isProjectAdmin(data.user.email, data.projectMember.projectId)

    let member = await this.saveMemberIfNotExist(
      data.projectMember.email,
      data.projectMember?.firstName,
      data.projectMember?.lastName);
    this.logger.debug(member);

    let mp = new MemberProjectEntity();
    mp.member = member;
    mp.project = memberProject.project;
    mp.role = RoleInProject.PROJECT_MEMBER;
    this.logger.debug(mp);
    let mpRes = await this.memberProjectRepo.save(mp);

    return new MemberProjectResDto().fromMemberProjectEntity(mpRes)

  }

  async removeMemberFromProject(data: any) {
    let currentUser = (await this.isProjectAdmin(data.user.email, data.projectMember.projectId)).member
    const mp = await this.memberProjectRepo.findOne({ relations: ['member'], where: { member: { id: data.projectMember.memberId }, project: { id: data.projectMember.projectId } } })

    if (!mp) {
      throw new Error("User is not a project Member");

    } else if (mp.member.id == currentUser.id) {
      this.logger.warn("Not allowed to remove yourself");
      throw new HttpException("Not allowed to remove yourself", HttpStatus.FORBIDDEN);

    } else if (mp.role == RoleInProject.PROJECT_OWNER) {
      this.logger.warn("Not allowed to remove project Owner");
      throw new HttpException("Not allowed to remove project Owner", HttpStatus.FORBIDDEN);
    }
    await this.memberProjectRepo.remove(mp);
    return "User was removed!";
  }

  async editMember(data: { user: any, projectMember: EditProjectMemberDto }): Promise<MemberResDto> {
    await this.isProjectAdmin(data.user.email, data.projectMember.projectId)

    const pm = await this.memberProjectRepo.findOne({
      relations: ['member'],
      where: { member: { id: data.projectMember.memberId } }
    })
    let member: MemberEntity;
    let role: string;

    if (pm) {
      member = pm.member;
      role = data.projectMember?.role;
      if (role) {
        if (role == RoleInProject.PROJECT_OWNER && pm.role != RoleInProject.PROJECT_OWNER) {
          this.logger.warn("Not allowed to set member to Owner");
          throw new HttpException("Not allowed to set member to Owner (Only one Owner Possible)", HttpStatus.FORBIDDEN);
        }
        pm.role = role;
        this.memberProjectRepo.save(pm);
      }
    } else {
      delete data.projectMember.role
      member = await this.memberRepo.findOne({ where: { id: data.projectMember.memberId } });
      if (!member) {
        throw new Error('User not found');
      }
    }
    let updatedMember = await this.memberRepo.save({ ...member, ...data.projectMember });
    return new MemberResDto().fromMemberEntity(updatedMember, role);
  }

  // todo get default project
  async getUserProjects(email: string): Promise<MemberProjectsResDto> {
    const memberProjectBuilder = this.memberProjectRepo.createQueryBuilder("member_project")
    const subQuery = memberProjectBuilder
      .select('member_project.projectId')
      .leftJoin('member_project.member', 'm')
      .where('m.email = :email', { email })
      .getQuery()

    const query = memberProjectBuilder
      .select('member_project.role')
      .leftJoinAndSelect('member_project.project', 'project')
      .leftJoinAndSelect('member_project.member', 'member')
      .where(`member_project.projectId IN (${subQuery})`)

    const res = await query.getRawMany();

    // map result to objects
    const groupedResult = res.reduce((acc, memberProject) => {
      const projectId = memberProject.project_id;

      let tokens: string = memberProject.project_tokens

      if (!acc.projects[projectId]) {
        let prj = new ProjectResDto()
        prj.id = projectId;
        prj.componentName = memberProject.project_component_name;
        prj.OS = memberProject.project_OS;
        prj.platformType = memberProject.project_platform_type;
        prj.formation = memberProject.project_formation;
        prj.category = memberProject.project_category;
        prj.artifactType = memberProject.project_artifact_type;
        prj.description = memberProject.project_description;
        prj.tokens = tokens != null ? tokens.split(',') : undefined
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
    const comps = await this.uploadVersionEntity.find({
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

  async createToken(data: { user: any, projectId: number, memberProject: MemberProjectEntity }): Promise<ProjectTokenDto> {
    const memberProject = data.memberProject;

    const token = this.generateToken(data.user.email, data.projectId, memberProject.project.componentName);
    this.logger.log(`Generated Token: ${token.projectToken}`)
    if (memberProject.project.tokens == null) {
      memberProject.project.tokens = [token.projectToken];
    } else {
      memberProject.project.tokens.push(token.projectToken);
    }
    this.projectRepo.save(memberProject.project);
    return token
  }

  private generateToken(email: string, projectId: number, projectName: string): ProjectTokenDto {
    const payload = { email: email, projectId: projectId, projectName: projectName }

    return { projectToken: this.jwtService.sign({ data: payload }) } as ProjectTokenDto;
  }

  async getProjectReleases(data: { user: any, projectId: number, memberProject: MemberProjectEntity }): Promise<ProjectReleasesDto[]> {
    let uploadVersions = await this.uploadVersionEntity.find({
      where: {
        project: { id: data.projectId }
      }
    })

    let projectReleases = uploadVersions.map(uv => {
      return new ProjectReleasesDto().formUploadEntity(uv)
    });

    return projectReleases
  }

}
