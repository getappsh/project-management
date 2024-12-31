import { RegulationTypeEntity } from "@app/common/database/entities";
import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";

@Injectable()
export class SeederService {
    private readonly logger = new Logger(SeederService.name);
    constructor(
        @InjectRepository(RegulationTypeEntity)
        private readonly regulationTypeRepository: Repository<RegulationTypeEntity>,
    ) {}

    async seedRegulationTypes() {
        this.logger.log('Seeding regulation types...');
        const defaultTypes = [
            { name: 'Boolean', description: 'A regulation that expects a boolean value, valid values: true' },
            { name: 'Threshold', description: 'A regulation that expects a value to meet a threshold' },
            { name: 'JUnit', description: 'A regulation that validates JUnit XML test results, valid value is threshold for pass percentage' },
        ];

        for (const type of defaultTypes) {
            const existing = await this.regulationTypeRepository.findOne({ where: { name: type.name } });
            if (!existing) {
                this.logger.debug(`Creating regulation type: ${type.name}`);
                const newType = this.regulationTypeRepository.create(type);
                await this.regulationTypeRepository.save(newType);
            }
        }
    }
}
