import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from './current-user.decorator';
import { IS_PUBLIC } from './public.decorator';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

/**
 * Global HTTP guard: every route needs `Authorization: Bearer <token>` of a live session unless
 * @Public().
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Sockets authenticate once, at the handshake, in the gateway.
    if (context.getType() !== 'http') {
      return true;
    }
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Missing access token');
    }
    const user = await this.tokens.verify(token);
    // The signature alone outlives a logout by the token's lifetime: the session must still exist.
    if (!(await this.sessions.exists(user.sessionId))) {
      throw new UnauthorizedException('Session ended');
    }
    request.user = user;
    return true;
  }
}
