import { RoleInProject } from "@app/common/database/entities";
import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsOptional, IsEmail, IsEnum, IsNumber } from "class-validator";
import { ProjectIdentifierParams } from "./project-identifier.dto";

export class AddMemberToProjectDto{
    projectIdentifier: string | number;
    
    projectId: number;

    @ApiProperty()
    @IsEmail()
    email: string;


    @ApiProperty({enum: RoleInProject, default: RoleInProject.PROJECT_MEMBER})
    @IsOptional()    
    @IsEnum(RoleInProject)
    role: RoleInProject = RoleInProject.PROJECT_MEMBER;
}

export class EditProjectMemberDto{
    
    projectIdentifier: string | number;

    memberId: number;

    projectId: number;


    @IsEnum(RoleInProject)
    @ApiProperty({enum: RoleInProject, default: RoleInProject.PROJECT_MEMBER})
    role: RoleInProject = RoleInProject.PROJECT_MEMBER;

}

export class ProjectMemberParams extends ProjectIdentifierParams{

    @ApiProperty()
    @IsNumber()
    @Type(() => Number)
    memberId: number;
}