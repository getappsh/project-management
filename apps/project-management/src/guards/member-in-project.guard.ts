import { CanActivate, ExecutionContext, Logger } from "@nestjs/common";
import { Injectable } from "@nestjs/common/decorators/core/injectable.decorator";
import { ProjectManagementService } from "../project-management.service";

@Injectable()
export class MemberInProjectGuard implements CanActivate {

    private readonly logger =  new Logger(MemberInProjectGuard.name)
    constructor(private readonly projectManagementService: ProjectManagementService){}
    
    async canActivate(context: ExecutionContext){
        const request = context.switchToHttp().getRequest();
        const memberProject =  await this.projectManagementService.getMemberInProjectByEmail(request.projectId, request.user.email);
        if (!memberProject){
            this.logger.debug(`User ${request.user.email} is not allowed to enter this project.`)
            return false;
        }
        request.memberProject = memberProject;
        return true
    }
}