import { ItemTypeEnum } from "@app/common/database/entities";
import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class PrepareDeliveryReqDto{

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  catalogId: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  deviceId: string;

  @ApiProperty({enum: ItemTypeEnum})
  @IsEnum(ItemTypeEnum)
  itemType: ItemTypeEnum

  @ApiProperty({ required: false, description: 'Custom absolute path for downloaded files. When provided, files are saved to this directory instead of the default.' })
  @IsString()
  @IsOptional()
  downloadFolder?: string;

  toString(){
    return JSON.stringify(this);
  }
} 