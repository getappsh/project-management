import { CanActivate, ExecutionContext, Logger } from "@nestjs/common";
import { Injectable } from "@nestjs/common/decorators/core/injectable.decorator";
import { ProjectManagementService } from "../project-management.service";
import { KafkaContext, TcpContext } from "@nestjs/microservices";

@Injectable()
export class MemberInProjectGuard implements CanActivate {

    private readonly logger =  new Logger(MemberInProjectGuard.name)
    constructor(private readonly projectManagementService: ProjectManagementService){}
    
    async canActivate(context: ExecutionContext){
        const input = context.switchToRpc();
        const msgContext = input.getContext();

        const request = input.getData();
        let user, projectId;
        if (msgContext instanceof KafkaContext){
            user = msgContext.getMessage()?.headers?.user;
            projectId = request?.projectId;
        }else if(msgContext instanceof TcpContext){
            user = request?.headers?.user;
            projectId = request?.value?.projectId;
        }

        if (!user){
            this.logger.debug(`User is not found in the request.`)
            return false;
        }
        if (!projectId){
            this.logger.debug(`ProjectId is not found in the request.`)
            return false;
        }

        const memberProject =  await this.projectManagementService.getMemberInProjectByEmail(projectId, user?.email);
        if (!memberProject){
            this.logger.debug(`User ${user?.email} is not a member of the project.`)
            return false;
        }
        request.memberProject = memberProject;
        return true
    }
}