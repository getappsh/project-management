import { ExecutionContext } from '@nestjs/common';
import { KafkaContext, TcpContext } from '@nestjs/microservices';


export function extractHeaders(context: ExecutionContext) {
  const input = context.switchToRpc();
  const msgContext = input.getContext();
 
  if (msgContext instanceof KafkaContext) {
    const headers = msgContext.getMessage().headers;
    if (headers?.user && typeof headers.user === 'string') {
      try {
        headers.user = JSON.parse(headers.user);
      } catch {}
    } else if (Buffer.isBuffer(headers?.user)) {
      try {
        headers.user = JSON.parse(headers.user.toString());
      } catch {}
    }
    return headers;
  } else if (msgContext instanceof TcpContext) {
    return input.getData()?.headers;
  }
  return {};
}


export function extractRequest(context: ExecutionContext): Record<string, any> | string {
  const input = context.switchToRpc();
  const msgContext = input.getContext();

  if (msgContext instanceof KafkaContext) {
    return input.getData();
  } else if (msgContext instanceof TcpContext) {
    return input.getData()?.value;
  }
  return {};
}
