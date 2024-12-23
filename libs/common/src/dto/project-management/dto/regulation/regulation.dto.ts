import { ApiProperty } from '@nestjs/swagger';
import { RegulationTypeDto } from './regulation-type.dto';
import { RegulationEntity } from '@app/common/database/entities';

export class RegulationDto {
    @ApiProperty({ description: 'ID of the regulation' })
    id: number;

    @ApiProperty({ description: 'Name of the regulation' })
    name: string;

    @ApiProperty({ description: 'Description of the regulation' })
    description: string;

    @ApiProperty({ description: 'Type of the regulation' , type: RegulationTypeDto})
    type: RegulationTypeDto;

    @ApiProperty({ description: 'Project associated with the regulation' })
    project: number;

    @ApiProperty({ description: 'Configuration of the regulation', required: false })
    config?: string;

    @ApiProperty({ description: 'Order of the regulation' })
    order: number;

    fromRegulationEntity(regulation: RegulationEntity) {
        this.id = regulation.id;
        this.name = regulation.name;
        this.description = regulation.description;
        this.type = regulation.type;
        this.project = regulation?.project?.id;
        this.config = regulation.config;
        this.order = regulation.order;
        return this;
    }

    toString() {
        return JSON.stringify(this);
    }
}