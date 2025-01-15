import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class GetProjectsQueryDto {
  @ApiPropertyOptional({
    description: 'If true, include only pinned projects',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  pinned?: boolean;

  @ApiPropertyOptional({
    description: 'Include pinned projects along with regular projects',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  includePinned?: boolean;

  @ApiPropertyOptional({
    description: 'The page number to fetch (default: 1)',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of projects per page (default: 10)',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  perPage?: number = 10;

 
}


export class SearchProjectsQueryDto {
  @ApiProperty({
    description: 'The search term (matches project name or partial match)',
  })
  @IsString()
  @Type(() => String)
  query: string;

  @ApiPropertyOptional({
    description: 'Filter by project status (active, completed, on-hold)',
    example: 'active',
  })
  @IsOptional()
  @IsString()
  @Type(() => String)
  status?: string;

  @ApiPropertyOptional({
    description: 'The page number to fetch (default: 1)',
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Number of projects per page (default: 10)',
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Type(() => Number)
  perPage?: number = 10;
}