import { extractHeaders } from "@app/common/microservice-client";
import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export const AuthUser = createParamDecorator( 
  (key: string, ctx: ExecutionContext) => {
 
  const headers = extractHeaders(ctx);
  const user = headers?.user;

  return key ? user?.[key] : user;

}); 