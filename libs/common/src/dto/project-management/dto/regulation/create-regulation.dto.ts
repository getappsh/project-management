import { IsNotEmpty, IsString, IsOptional, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRegulationDto {
    @ApiProperty({ description: 'Name of the regulation' })
    @IsNotEmpty()
    @IsString()
    name: string;

    @ApiProperty({ description: 'Description of the regulation', required: false })
    @IsString()
    @IsOptional()
    description?: string;

    @ApiProperty({ description: 'ID of the regulation type' })
    @IsNotEmpty()
    @IsNumber()
    typeId: number;

    @ApiProperty({ description: 'ID of the project' })
    @IsNotEmpty()
    @IsNumber()
    projectId: number;

    @ApiProperty({ description: 'Configuration of the regulation', required: false })
    @IsOptional()
    @IsString()
    config?: string;

    @ApiProperty({ description: 'Order of the regulation', default: 0, required: false })
    @IsOptional()
    @IsNumber()
    order?: number;
}