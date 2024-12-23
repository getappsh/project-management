import { IsNotEmpty, IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateRegulationDto {

    id: number;

    @ApiProperty({ description: 'Name of the regulation', required: false })
    @IsOptional()
    @IsString()
    name?: string;

    @ApiProperty({ description: 'Description of the regulation', required: false })
    @IsOptional()
    @IsString()
    description?: string;

    @ApiProperty({ description: 'ID of the regulation type', required: false })
    @IsOptional()
    @IsNumber()
    typeId?: number;

    @ApiProperty({ description: 'ID of the project', required: false })
    @IsOptional()
    @IsNumber()
    projectId?: number;

    @ApiProperty({ description: 'Configuration of the regulation', required: false })
    @IsOptional()
    @IsString()
    config?: string;

    @ApiProperty({ description: 'Order of the regulation', required: false })
    @IsOptional()
    @IsNumber()
    order?: number;
}