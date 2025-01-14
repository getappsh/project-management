import { CanActivate, ExecutionContext, ForbiddenException, Logger } from "@nestjs/common";
import { Injectable } from "@nestjs/common/decorators/core/injectable.decorator";
import { ProjectManagementService } from "../project-management.service";
import { extractHeaders, extractRequest } from "@app/common/microservice-client";
import { Reflector } from "@nestjs/core";

@Injectable()
export class MemberInProjectGuard implements CanActivate {

    private readonly logger =  new Logger(MemberInProjectGuard.name)
    constructor(private readonly projectManagementService: ProjectManagementService, private reflector: Reflector){}

    async canActivate(context: ExecutionContext){
        const roles = this.reflector.get<string[]>('roles', context.getHandler());

        let headers = extractHeaders(context)
        let request = extractRequest(context);

        let user = headers?.user;
        let projectIdentifier = request.projectIdentifier ?? request?.projectId

        if (!user){
            throw new ForbiddenException(`User is not found in the request.`);
        }
        if (!projectIdentifier){
            throw new ForbiddenException(`ProjectId is not found in the request.`);
        }

        const memberProject = await this.projectManagementService.getMemberInProjectByEmail(projectIdentifier, user?.email);
        if (!memberProject){
            throw new ForbiddenException(`User ${user?.email} is not a member of the project.`);
        }

        if (!roles || roles.length === 0) {
            return true;
        }
        
        const hasRole = roles.some(role => role == memberProject.role);

        if (!hasRole){
            throw new ForbiddenException(`User ${user?.email} does not have the required role.`);

        }
        return true
    }
}