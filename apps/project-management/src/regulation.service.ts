import { RegulationEntity, RegulationTypeEntity, UploadVersionEntity, ProjectEntity } from "@app/common/database/entities";
import { CreateRegulationDto, RegulationChangedEvent, RegulationChangedEventType, RegulationDto, RegulationParams, RegulationTypeDto, UpdateRegulationDto } from "@app/common/dto/project-management";
import { MicroserviceClient, MicroserviceName } from "@app/common/microservice-client";
import { UploadTopicsEmit } from "@app/common/microservice-client/topics";
import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { lastValueFrom } from "rxjs";
import { Repository } from "typeorm";

@Injectable()
export class RegulationService {
  private readonly logger = new Logger(RegulationService.name);

  constructor(
    @InjectRepository(RegulationEntity) private readonly regulationRepo: Repository<RegulationEntity>,
    @InjectRepository(RegulationTypeEntity) private readonly regulationTypeRepo: Repository<RegulationTypeEntity>,
    @InjectRepository(ProjectEntity) private readonly projectRepo: Repository<ProjectEntity>,
    @Inject(MicroserviceName.UPLOAD_SERVICE) private readonly uploadClient: MicroserviceClient,
    
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

    if (regulationType.name == "Boolean"){
      regulation.config = undefined;
    }
    const newRegulation = new RegulationEntity();
    newRegulation.name = regulation.name;
    newRegulation.description = regulation.description;
    newRegulation.config = regulation.config;
    newRegulation.order = regulation.order;
    newRegulation.displayName = regulation.displayName;
    newRegulation.type = regulationType;
    newRegulation.project = project;

    this.validateConfig(newRegulation);

    try {
      const result = await this.regulationRepo.save(newRegulation);
      this.sendRegulationChangedEvent({ type: RegulationChangedEventType.CREATED, projectId: regulation.projectId, regulation: regulation.name });

      return new RegulationDto().fromRegulationEntity(result);
    }catch (err) {
      if (err.code == '23505') {
        throw new ConflictException(`Regulation with name '${regulation.name}' already exists`);
      }
      throw err
    }

  }

  async updateRegulation(dto: UpdateRegulationDto): Promise<RegulationDto> {
    this.logger.log('Update regulation');

    const currentRegulation = await this.regulationRepo.findOne({ where: { name: dto.regulation, project: { id: dto.projectId } } });
    if (!currentRegulation) {
      throw new NotFoundException(`Regulation ${dto.regulation} for Project ID ${dto.projectId} not found`);
    }

    const regulationEntity = new RegulationEntity();
    regulationEntity.name = dto?.name;
    regulationEntity.description = dto?.description;
    regulationEntity.config = dto?.config;
    regulationEntity.order = dto?.order;
    regulationEntity.displayName = dto?.displayName;

    if (dto?.typeId) {
      const regulationType = await this.regulationTypeRepo.findOne({ where: { id: dto.typeId } });
      if (!regulationType) {
        throw new NotFoundException(`Regulation type with id ${dto.typeId} not found`);
      }
      regulationEntity.type = regulationType;
    }

    const updatedRegulation = { ...currentRegulation, ...regulationEntity };

    this.validateConfig(updatedRegulation);
    
    try {
      const result = await this.regulationRepo.save(updatedRegulation);
      return new RegulationDto().fromRegulationEntity(result);
    }catch (err) {
      if (err.code == '23505') {
        throw new ConflictException(`Regulation with name '${dto.name}' already exists`);
      }
      throw err
    }
  }


  async getRegulationByName(params: RegulationParams): Promise<RegulationDto> {
    this.logger.log(`Get regulation by name: ${params.regulation}`);
    const regulation = await this.regulationRepo.findOne({ where: { name: params.regulation, project: { id: params.projectId } }, relations: { project: true }, select: { project: { id: true } } });
    if (!regulation) {
      throw new NotFoundException(`Regulation ${params.regulation} for Project ID ${params.projectId} not found`);
    }
    return new RegulationDto().fromRegulationEntity(regulation);
  }

  async deleteRegulation(params: RegulationParams): Promise<string> {
    this.logger.log('Delete regulation');

    let { raw, affected } = await this.regulationRepo.delete({ name: params.regulation, project: { id: params.projectId } });
    if (affected == 0) {
      throw new NotFoundException(`Regulation ${params.regulation} for Project ID ${params.projectId} not found`);
    }

    this.sendRegulationChangedEvent({ type: RegulationChangedEventType.DELETED, ...params})

    return 'Regulation deleted';
  }



  private async sendRegulationChangedEvent(event: RegulationChangedEvent) {
    await lastValueFrom(this.uploadClient.emit(UploadTopicsEmit.PROJECT_REGULATION_CHANGED, event))
      .then(() => this.logger.debug(`Sent to upload service regulation changed event: ${JSON.stringify(event)} `))
      .catch(err => this.logger.error(`Error sending regulation changed event: ${JSON.stringify(event)}, error: ${err}`));
  }

  private validateConfig(regulation: RegulationEntity) {
    switch (regulation.type.name) {
      case 'Boolean':
        regulation.config = undefined;
        break;
      case 'Threshold':
      case 'JUnit':
        const configValue = Number(regulation.config);
        if (isNaN(configValue)) {
            throw new BadRequestException('Config value for Threshold type must be a number');
        }
        break
    }
  }
}