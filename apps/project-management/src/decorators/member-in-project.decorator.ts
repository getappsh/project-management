import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common"
import { MemberInProjectGuard } from "../guards/member-in-project.guard"

export const MemberInProject = (...roles: string[]) => {
  return applyDecorators(
    SetMetadata('roles', roles),
    UseGuards(MemberInProjectGuard)
  ) 
}