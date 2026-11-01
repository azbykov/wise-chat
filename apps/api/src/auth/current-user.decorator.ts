import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Who the access token belongs to, as JwtAuthGuard puts it on the request. */
export interface AuthUser {
  id: string;
  username: string;
  /** The session the access token was issued for. */
  sessionId: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const user = context.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
  if (!user) {
    // Only reachable when a @Public() route asks for the user: a programming error.
    throw new Error('CurrentUser used on a route without an authenticated user');
  }
  return user;
});
