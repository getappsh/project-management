import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsOptional } from "class-validator";
import { Transform } from "class-transformer";

export class LabelDto {
  @ApiProperty({ description: 'Unique identifier of the label' })
  id: number;

  @ApiProperty({ description: 'Name of the label' })
  name: string;

  toString() {
    return JSON.stringify(this);
  }
}

export class LabelNameDto {
  @IsString()
  @IsOptional()
  @ApiProperty({ description: 'Name of the label' })
  @Transform(({ value }) => value?.trim())
  name: string;
}