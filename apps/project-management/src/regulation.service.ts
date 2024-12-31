import { RegulationEntity, RegulationTypeEntity, RegulationStatusEntity, UploadVersionEntity, ProjectEntity } from "@app/common/database/entities";
import { CreateRegulationDto, RegulationDto, RegulationParams, RegulationStatusDto, RegulationStatusParams, RegulationTypeDto, SetRegulationCompliancyDto, SetRegulationStatusDto, UpdateRegulationDto, VersionRegulationStatusParams } from "@app/common/dto/project-management";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

@Injectable()
export class RegulationService {
  private readonly logger = new Logger(RegulationService.name);

  constructor(
    @InjectRepository(RegulationEntity) private readonly regulationRepo: Repository<RegulationEntity>,
    @InjectRepository(RegulationTypeEntity) private readonly regulationTypeRepo: Repository<RegulationTypeEntity>,
    @InjectRepository(RegulationStatusEntity) private readonly regulationStatusRepo: Repository<RegulationStatusEntity>,
    @InjectRepository(UploadVersionEntity) private readonly uploadVersionRepo: Repository<UploadVersionEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
  ) { }


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