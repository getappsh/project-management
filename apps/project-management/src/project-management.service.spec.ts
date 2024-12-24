import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { In, Repository } from 'typeorm';
import { ProjectManagementService } from './project-management.service';
import { MemberProjectEntity, MemberEntity, ProjectEntity, RoleInProject, UploadVersionEntity, CategoryEntity, FormationEntity, OperationSystemEntity, PlatformEntity, DeviceEntity, DiscoveryMessageEntity } from '@app/common/database/entities';
import { mockCategoryRepo, mockDeviceRepo, mockFormationRepo, mockMemberProjectRepo, mockMemberRepo, mockOperationSystemRepo, mockPlatformRepo, mockProjectRepo, mockUploadVersionRepo } from '@app/common/database/test/support/__mocks__';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ProjectConfigDto, projectMemberDtoStub } from '@app/common/dto/project-management';
import { categoryEntityStub, categoryInputStub, deviceEntityStub, formationEntityStub, memberEntityStub, memberProjectEntityStub, operationSystemEntityStub, operationSystemInputStub, platformEntityStub, projectEntityStub } from '@app/common/database/test/support/stubs';
import { projectDtoStub, MemberProjectResDto, MemberProjectsResDto, MemberResDto, ProjectDto, DeviceResDto, ProjectReleasesDto } from '@app/common/dto/project-management';
import { ConflictException, HttpException } from '@nestjs/common';
import { editProjectMemberDtoStub } from '@app/common/dto/project-management';

describe('ProjectManagementService', () => {
  let service: ProjectManagementService;
  let jwtService: JwtService;
  let uploadVersionEntity: Repository<UploadVersionEntity>;
  let categoryEntity: Repository<CategoryEntity>;
  let formationEntity: Repository<FormationEntity>;
  let operationSystemEntity: Repository<OperationSystemEntity>;
  let platformEntity: Repository<PlatformEntity>;
  let memberProjectRepo: Repository<MemberProjectEntity>;
  let memberRepo: Repository<MemberEntity>;
  let projectRepo: Repository<ProjectEntity>;
  let deviceRepo: Repository<DeviceEntity>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectManagementService,
        JwtService,
        { provide: getRepositoryToken(UploadVersionEntity), useValue: mockUploadVersionRepo() },
        { provide: getRepositoryToken(CategoryEntity), useValue: mockCategoryRepo() },
        { provide: getRepositoryToken(FormationEntity), useValue: mockFormationRepo() },
        { provide: getRepositoryToken(OperationSystemEntity), useValue: mockOperationSystemRepo() },
        { provide: getRepositoryToken(PlatformEntity), useValue: mockPlatformRepo() },
        { provide: getRepositoryToken(MemberProjectEntity), useValue: mockMemberProjectRepo() },
        { provide: getRepositoryToken(MemberEntity), useValue: mockMemberRepo() },
        { provide: getRepositoryToken(ProjectEntity), useValue: mockProjectRepo() },
        { provide: getRepositoryToken(DeviceEntity), useValue: mockDeviceRepo() },

      ],
    }).compile();

    service = module.get<ProjectManagementService>(ProjectManagementService);
    jwtService = module.get<JwtService>(JwtService);
    uploadVersionEntity = module.get<Repository<UploadVersionEntity>>('UploadVersionEntityRepository');
    categoryEntity = module.get<Repository<CategoryEntity>>('CategoryEntityRepository');
    formationEntity = module.get<Repository<FormationEntity>>('FormationEntityRepository');
    operationSystemEntity = module.get<Repository<OperationSystemEntity>>('OperationSystemEntityRepository');
    platformEntity = module.get<Repository<PlatformEntity>>('PlatformEntityRepository');
    memberProjectRepo = module.get<Repository<MemberProjectEntity>>('MemberProjectEntityRepository');
    memberRepo = module.get<Repository<MemberEntity>>('MemberEntityRepository');
    projectRepo = module.get<Repository<ProjectEntity>>('ProjectEntityRepository');
    deviceRepo = module.get<Repository<DeviceEntity>>('DeviceEntityRepository');
  });

  describe('getMemberInProjectByEmail', () => {
    it('should return the member in the project with the given email', async () => {
      const projectMember = projectMemberDtoStub()
      const projectId = projectMember.projectId;
      const email = projectMember.email;

      const result = await service.getMemberInProjectByEmail(projectId, email);

      expect(result).toStrictEqual(memberProjectEntityStub());
      expect(memberProjectRepo.findOne).toHaveBeenCalledWith({
        relations: ['project', 'member'],
        where: {
          project: { id: projectId },
          member: { email: email },
        },
      });
    });
  });
  
  describe('projectConfigOption', () => {

    it('should set project configuration options and return them', async () => {
      const configOptions: ProjectConfigDto = {
        platforms: platformEntityStub().name,
        formations: formationEntityStub().name,
        categories: [categoryEntityStub().name, categoryInputStub().name],
        operationsSystem: operationSystemInputStub().name
      }
      const result = await service.setProjectConfigOption(configOptions);
  
      expect(result).toEqual({
        platforms: [],
        formations: [],
        categories: [categoryInputStub().name],
        operationsSystem: [operationSystemInputStub().name],
      });
      
      expect(platformEntity.findOne).toHaveBeenCalledWith({ where: {name: platformEntityStub().name} })
      expect(formationEntity.findOne).toHaveBeenCalledWith({ where: {name: formationEntityStub().name} })
      expect(categoryEntity.findOne).toHaveBeenCalledWith({ where: {name: categoryEntityStub().name} })
      expect(categoryEntity.findOne).toHaveBeenCalledWith({ where: {name: categoryInputStub().name} })
      expect(operationSystemEntity.findOne).toHaveBeenCalledWith({ where: {name: operationSystemInputStub().name} })
      expect(categoryEntity.save).toHaveBeenCalledWith([categoryInputStub()])
      expect(operationSystemEntity.save).toHaveBeenCalledWith([operationSystemInputStub()])
    });

    it('should return project configuration options', async () => {
      const platforms = [platformEntityStub(), platformEntityStub()];
      const formations = [formationEntityStub(), formationEntityStub()];
      const categories = [categoryEntityStub(), categoryEntityStub()];
      const operationSystems = [operationSystemEntityStub(), operationSystemEntityStub()];

      const result = await service.getProjectConfigOption();

      expect(result).toEqual({
        platforms: platforms.map((val) => val.name),
        formations: formations.map((val) => val.name),
        categories: categories.map((val) => val.name),
        operationsSystem: operationSystems.map((val) => val.name),
      });
      expect(platformEntity.find).toHaveBeenCalledWith({ select: ['name'] });
      expect(formationEntity.find).toHaveBeenCalledWith({ select: ['name'] });
      expect(categoryEntity.find).toHaveBeenCalledWith({ select: ['name'] });
      expect(operationSystemEntity.find).toHaveBeenCalledWith({ select: ['name'] });
    });
  });


  describe('createProject', () => {
    it('should create a new project', async () => {
      const data = {
        member: { email: 'test@example.com', given_name: 'John', family_name: 'Doe' },
        project: projectDtoStub(),
      };
      const createdMemberProjectEntity = memberProjectEntityStub();
      createdMemberProjectEntity.role = RoleInProject.PROJECT_OWNER;
      const projectResDto = new ProjectDto().fromProjectEntity(createdMemberProjectEntity.project);

      const result = await service.createProject(data);

      expect(result).toEqual(projectResDto);

      expect(memberRepo.findOne).toHaveBeenCalledWith({ where: { email: data.member.email } })

      expect(projectRepo.create).toHaveBeenCalledWith(data.project);
      expect(projectRepo.save).toHaveBeenCalledWith(createdMemberProjectEntity.project);
      expect(memberProjectRepo.save).toHaveBeenCalledWith(createdMemberProjectEntity);
    });

    it('should throw a ConflictException if the component name already exists', async () => {
      const data = {
        member: { email: 'test@example.com', given_name: 'John', family_name: 'Doe' },
        project: projectDtoStub(),
      };
      const createdProjectEntity = projectEntityStub();
      const createdMemberEntity = memberEntityStub();

      jest.spyOn(memberRepo, 'findOne').mockResolvedValueOnce(null);
      jest.spyOn(projectRepo, 'save').mockRejectedValueOnce({ code: '23505' });

      await expect(service.createProject(data)).rejects.toThrow(ConflictException);

      expect(memberRepo.findOne).toHaveBeenCalledWith({ where: { email: data.member.email } })
      expect(memberRepo.save).toHaveReturnedWith(Promise.resolve(createdMemberEntity))

      expect(projectRepo.create).toHaveBeenCalledWith(data.project);
      expect(projectRepo.save).toHaveBeenCalledWith(createdProjectEntity);
    });
  });

  describe('addMemberToProject', () => {
    it('should add a member to a project', async () => {
      const data = {
        user: { email: 'test@example.com' },
        projectMember: projectMemberDtoStub(),
      };
      const createdMemberProjectEntity = memberProjectEntityStub();

      const result = await service.addMemberToProject(data);

      expect(result).toBeInstanceOf(MemberProjectResDto);
      expect(result.member.email).toBe(data.projectMember.email)
      expect(result.project.id).toBe(data.projectMember.projectId)

      expect(memberProjectRepo.findOne).toBeCalledWith({
        relations: ['project', 'member'],
        where: {
          project: {
            id: data.projectMember.projectId
          },
          member: {
            email: data.user.email
          },
          role: expect.anything()
        }
      })

      expect(memberRepo.findOne).toHaveBeenCalledWith({ where: { email: data.projectMember.email } })
      expect(memberProjectRepo.save).toHaveBeenCalledWith(createdMemberProjectEntity);
    });

    it('should throw a HttpException if the user is not admin or owner', async () => {
      const data = {
        user: { email: 'test@example.com' },
        projectMember: projectMemberDtoStub(),
      };
      jest.spyOn(memberProjectRepo, 'findOne').mockResolvedValueOnce(null);

      await expect(service.addMemberToProject(data)).rejects.toThrow(HttpException);

      expect(memberProjectRepo.findOne).toBeCalledWith({
        relations: ['project', 'member'],
        where: {
          project: {
            id: data.projectMember.projectId
          },
          member: {
            email: data.user.email
          },
          role: expect.anything()
        }
      })
    });
  });

  describe('removeMemberFromProject', () => {
    it('should remove a member from a project', async () => {
      const data = {
        user: { email: 'test@example.com' },
        projectMember: { memberId: memberEntityStub().id, projectId: projectEntityStub().id },
      };
      let memberProject = memberProjectEntityStub()

      memberProject.member.id++;
      jest.spyOn(memberProjectRepo, 'findOne').mockResolvedValueOnce(memberProject);

      const result = await service.removeMemberFromProject(data);
      expect(result).toEqual('User was removed!');

      expect(memberProjectRepo.findOne).toBeCalledWith({ relations: ['project', 'member'], where: { project: { id: data.projectMember.projectId }, member: { email: data.user.email }, role: expect.anything() } })
      expect(memberProjectRepo.findOne).toBeCalledWith({ relations: ['member'], where: { member: { id: data.projectMember.memberId }, project: { id: data.projectMember.projectId } } });
      memberProject.member.id--;
      expect(memberProjectRepo.remove).toHaveBeenCalledWith(memberProject);
    });

    it('should throw an error if the user is not a project member', async () => {
      const data = {
        user: { email: 'test@example.com' },
        projectMember: { memberId: memberEntityStub().id, projectId: projectEntityStub().id },
      };

      jest.spyOn(memberProjectRepo, 'findOne').mockResolvedValueOnce(memberProjectEntityStub());
      jest.spyOn(memberProjectRepo, 'findOne').mockResolvedValueOnce(null);

      await expect(service.removeMemberFromProject(data)).rejects.toThrow(Error);
      expect(memberProjectRepo.findOne).toHaveBeenCalledTimes(2);
      expect(memberProjectRepo.remove).not.toHaveBeenCalled();
    });

    it('should throw an HttpException if the current user tries to remove themselves', async () => {
      const data = {
        user: { email: 'test@example.com' },
        projectMember: { memberId: memberEntityStub().id, projectId: projectEntityStub().id },
      };

      await expect(service.removeMemberFromProject(data)).rejects.toThrow("Not allowed to remove yourself");
      expect(memberProjectRepo.findOne).toHaveBeenCalledTimes(2);
      expect(memberProjectRepo.remove).not.toHaveBeenCalled();
    });

    it('should throw an HttpException if the member to be removed is a project owner', async () => {
      const data = {
        user: { email: 'test@example.com' },
        projectMember: { memberId: memberEntityStub().id, projectId: projectEntityStub().id },
      };
      let memberProject1 = memberProjectEntityStub()
      let memberProject2 = memberProjectEntityStub()
      memberProject2.member.id++;
      memberProject2.role = RoleInProject.PROJECT_OWNER;

      jest.spyOn(memberProjectRepo, 'findOne').mockResolvedValueOnce(memberProject1);
      jest.spyOn(memberProjectRepo, 'findOne').mockResolvedValueOnce(memberProject2);

      await expect(service.removeMemberFromProject(data)).rejects.toThrow("Not allowed to remove project Owner");
      expect(memberProjectRepo.findOne).toHaveBeenCalledTimes(2);
      expect(memberProjectRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('editMember', () => {
    it('should edit the role, firstName and lastName of a project member ', async () => {
      const data = {
        user: { email: 'admin@example.com' },
        projectMember: editProjectMemberDtoStub(),
      };
      const pm = memberProjectEntityStub();

      const result = await service.editMember(data);

      expect(result).toBeInstanceOf(MemberResDto);
      expect(result.id).toBe(data.projectMember.memberId);
      expect(result.role).toBe(data.projectMember.role);
      expect(result.firstName).toBe(data.projectMember.firstName);
      expect(result.lastName).toBe(data.projectMember.lastName);

      expect(memberProjectRepo.findOne).toBeCalled();
      expect(memberProjectRepo.findOne).toBeCalledWith({ relations: ['member'], where: { member: { id: data.projectMember.memberId } } });


      expect(memberProjectRepo.save).toHaveBeenCalledWith(pm);
      expect(memberRepo.save).toHaveBeenCalledWith(expect.objectContaining(pm.member));

      expect(memberRepo.findOne).not.toHaveBeenCalled();
    });

    it('should throw an error if the user is not a project admin', async () => {
      const data = {
        user: { email: 'admin@example.com' },
        projectMember: editProjectMemberDtoStub(),
      };
      jest.spyOn(memberProjectRepo, 'findOne').mockResolvedValueOnce(null);

      await expect(service.editMember(data)).rejects.toThrowError(HttpException);

      expect(memberProjectRepo.findOne).toHaveBeenCalledTimes(1);

      expect(memberProjectRepo.save).not.toHaveBeenCalled();
      expect(memberRepo.findOne).not.toHaveBeenCalled();
      expect(memberRepo.save).not.toHaveBeenCalled();
    });

    it('should throw an error if the project member is not found', async () => {
      const data = {
        user: { email: 'admin@example.com' },
        projectMember: editProjectMemberDtoStub(),
      };

      jest.spyOn(memberProjectRepo, 'findOne').mockResolvedValueOnce(memberProjectEntityStub());
      jest.spyOn(memberProjectRepo, 'findOne').mockResolvedValueOnce(null);
      jest.spyOn(memberRepo, 'findOne').mockResolvedValueOnce(null);


      await expect(service.editMember(data)).rejects.toThrowError('User not found');
      expect(memberProjectRepo.findOne).toHaveBeenCalledTimes(2);
      expect(memberProjectRepo.findOne).toReturnWith(Promise.resolve(null));

      expect(memberRepo.findOne).toBeCalledWith({ where: { id: data.projectMember.memberId } });
      expect(memberRepo.findOne).toReturnWith(Promise.resolve(null));

      expect(memberProjectRepo.save).not.toHaveBeenCalled();
      expect(memberRepo.save).not.toHaveBeenCalled();
    });

    it('should throw an error when trying to set a member as an owner if there is already an owner', async () => {
      const data = {
        user: { email: 'admin@example.com' },
        projectMember: editProjectMemberDtoStub(),
      };
      data.projectMember.role = RoleInProject.PROJECT_OWNER;

      await expect(service.editMember(data)).rejects.toThrowError("Not allowed to set member to Owner (Only one Owner Possible)");
      expect(memberProjectRepo.findOne).toHaveBeenCalledTimes(2);
      expect(memberProjectRepo.save).not.toHaveBeenCalled();
      expect(memberRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('getUserProjects', () => {
    it('should return user projects and member details', async () => {
      const pm = memberProjectEntityStub()
      const email = pm.member.email
      const projectId = pm.project.id;

      const rawResult = [
        {
          project_id: projectId,
          project_component_name: pm.project.componentName,
          project_OS: pm.project.OS.name,
          project_platform_type: pm.project.platformType.name,
          project_formation: pm.project.formation.name,
          project_category: pm.project.category.name,
          project_artifact_type: pm.project.artifactType,
          project_description: pm.project.description,
          member_id: pm.member.id,
          member_email: pm.member.email,
          member_first_name: pm.member.firstName,
          member_last_name: pm.member.lastName,
          member_project_role: pm.role,
          member_default_project: pm.project.id
        }
      ];

      const memberProjectQueryBuilder: any = {
        select: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getQuery: jest.fn().mockReturnValue('subQuery'),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rawResult)


      };
      memberProjectRepo.createQueryBuilder = jest.fn(() => memberProjectQueryBuilder);

      // TODO make this dot stub
      const expectedProjectDto = new ProjectDto();
      expectedProjectDto.id = projectId;
      expectedProjectDto.componentName = pm.project.componentName;
      expectedProjectDto.OS = pm.project.OS.name;
      expectedProjectDto.platformType = pm.project.platformType.name;
      expectedProjectDto.formation = pm.project.formation.name;
      expectedProjectDto.category = pm.project.category.name;
      expectedProjectDto.artifactType = pm.project.artifactType;
      expectedProjectDto.description = pm.project.description;
      expectedProjectDto.members = []

      const expectedMemberDto = new MemberResDto();
      expectedMemberDto.id = pm.member.id;
      expectedMemberDto.email = pm.member.email;
      expectedMemberDto.firstName = pm.member.firstName;
      expectedMemberDto.lastName = pm.member.lastName;
      expectedMemberDto.role = pm.role;
      expectedMemberDto.defaultProject = expectedProjectDto.id;

      const expectedMemberProjectsDto = new MemberProjectsResDto();
      expectedMemberProjectsDto.projects = [expectedProjectDto];
      expectedMemberProjectsDto.member = expectedMemberDto;

      const result = await service.getUserProjects(email);

      expect(result).toBeInstanceOf(MemberProjectsResDto)
      expect(result).toEqual(expectedMemberProjectsDto);

      expect(memberProjectRepo.createQueryBuilder).toHaveBeenCalledWith('member_project');
      expect(memberProjectQueryBuilder.select).toHaveBeenCalledWith('member_project.projectId');
      expect(memberProjectQueryBuilder.leftJoin).toHaveBeenCalledWith('member_project.member', 'm');
      expect(memberProjectQueryBuilder.where).toHaveBeenCalledWith('m.email = :email', { email });
      expect(memberProjectQueryBuilder.getQuery).toHaveBeenCalled();

      expect(memberProjectQueryBuilder.select).toHaveBeenCalledWith('member_project.role');
      expect(memberProjectQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('member_project.project', 'project');
      expect(memberProjectQueryBuilder.leftJoinAndSelect).toHaveBeenCalledWith('member_project.member', 'member');
      expect(memberProjectQueryBuilder.where).toHaveBeenCalledWith(`member_project.projectId IN (subQuery)`);
      expect(memberProjectQueryBuilder.getRawMany).toHaveBeenCalled();
    });
  });

  describe('getDevicesByCatalogId', () => {
    it('should return devices by catalog ID', async () => {
      const catalogId = "1";
      const queryBuilder: any = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([deviceEntityStub, deviceEntityStub])
      };

      deviceRepo.createQueryBuilder = jest.fn(() => queryBuilder);

      const result = await service.getDevicesByCatalogId(catalogId);

      expect(result.every(item => item instanceof DeviceResDto)).toBe(true);

      expect(deviceRepo.createQueryBuilder).toHaveBeenCalledWith('device');
      expect(queryBuilder.leftJoin).toHaveBeenCalledWith('device.components', 'component');
      expect(queryBuilder.where).toHaveBeenCalledWith('component.catalogId = :catalogId', { catalogId });
      expect(queryBuilder.getMany).toHaveBeenCalled();
    });
  });

  describe('getDevicesByProject', () => {
    it('should return devices by project ID', async () => {
      const projectId = 1;

      const queryBuilder: any = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([deviceEntityStub, deviceEntityStub])
      };

      deviceRepo.createQueryBuilder = jest.fn(() => queryBuilder);

      const result = await service.getDevicesByProject(projectId);

      expect(result.every(item => item instanceof DeviceResDto)).toBe(true);

      expect(uploadVersionEntity.find).toHaveBeenCalledWith({
        select: ['catalogId'],
        where: {
          project: { id: projectId }
        }
      });
      expect(deviceRepo.createQueryBuilder).toHaveBeenCalledWith('device');
      expect(queryBuilder.leftJoin).toHaveBeenCalledWith('device.components', 'component');
      expect(queryBuilder.where).toHaveBeenCalledWith('component.catalogId IN (:...catalogsId)', { catalogsId: expect.any(Array) });
      expect(queryBuilder.getMany).toHaveBeenCalled();
    });
  });

  describe('getDevicesByPlatform', () => {
    it('should return devices by platform name', async () => {
      const platformName = 'Platform 1';

      const queryBuilder: any = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([deviceEntityStub, deviceEntityStub])
      };
      deviceRepo.createQueryBuilder = jest.fn(() => queryBuilder);

      const result = await service.getDevicesByPlatform(platformName);

      expect(result.every(item => item instanceof DeviceResDto)).toBe(true);

      expect(deviceRepo.createQueryBuilder).toHaveBeenCalledWith('device');
      expect(queryBuilder.leftJoin).toHaveBeenCalledWith(DiscoveryMessageEntity, 'dsc_msg', "dsc_msg.deviceID = device.ID");
      expect(queryBuilder.where).toHaveBeenCalledWith(
        `dsc_msg.discoveryData ->'platform'->>'name' = :platformName`,
        { platformName }
      );
      expect(queryBuilder.getMany).toHaveBeenCalled();
    });
  });

  describe('createToken', () => {
    it('should create a project token', async () => {
      const user = { email: 'user@example.com' };
      const pm = memberProjectEntityStub()
      const project = projectEntityStub()
      const newToken = 'newToken'

      jwtService.sign = jest.fn().mockReturnValue(newToken)

      const result = await service.createToken({ user: user, projectId: pm.project.id, memberProject: pm });
      expect(result).toEqual({ projectToken: expect.any(String) });

      expect(jwtService.sign).toHaveBeenCalledWith({
        data: {
          email: user.email,
          projectId: pm.project.id,
          projectName: pm.project.componentName
        }
      });

      project.tokens.push(newToken)
      expect(projectRepo.save).toHaveBeenCalledWith(project);
    });
  });

  describe('getProjectReleases', () => {
    it('should return project releases', async () => {
      const user = { email: 'user@example.com' };
      const projectId = projectEntityStub().id;

      const result = await service.getProjectReleases({ user, projectId, memberProject: null });

      expect(result.every(item => item instanceof ProjectReleasesDto)).toBe(true);

      expect(uploadVersionEntity.find).toHaveBeenCalledWith({
        where: { project: { id: projectId } },
      });
    });
  });

});
