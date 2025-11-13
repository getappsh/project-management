//create dto file for following properties: projectId: number, version: string, scriptFileName: string
import { ApiProperty } from "@nestjs/swagger";
import { ProjectIdentifierParams } from "./project-identifier.dto";

export class ProjectAddScriptMetadataDto extends ProjectIdentifierParams {
  
  @ApiProperty({ required: true })
  version: string;
    @ApiProperty({ required: true })
    scriptFileName: string;
}