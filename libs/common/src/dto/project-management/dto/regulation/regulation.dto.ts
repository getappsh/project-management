import { ApiProperty } from '@nestjs/swagger';
import { RegulationTypeDto } from './regulation-type.dto';

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
}