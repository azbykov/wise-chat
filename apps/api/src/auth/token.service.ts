import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthUser } from './current-user.decorator';

/** Lets the client tell an expired token (sign in again) from a broken one. */
export class TokenExpiredException extends UnauthorizedException {
  constructor() {
    super({ message: 'Access token expired', details: { code: 'TOKEN_EXPIRED' } });
  }
}

/** Playback links carry their own audience, so a media token is never taken for an access token. */
const MEDIA_AUDIENCE = 'story-media';

interface AccessPayload {
  sub: string;
  username: string;
  sid?: string;
  exp: number;
}

/** A verified access token: who it is for, and when it stops working (ms since the epoch). */
export interface AccessClaims extends AuthUser {
  expiresAt: number;
}

/** Access tokens for both the HTTP guard and, later, the socket handshake. */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService) {}

  sign(user: AuthUser): Promise<string> {
    return this.jwt.signAsync(
      { username: user.username, sid: user.sessionId },
      { subject: user.id },
    );
  }

  async verify(token: string): Promise<AccessClaims> {
    let payload: AccessPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessPayload>(token);
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new TokenExpiredException();
      }
      throw new UnauthorizedException('Invalid access token');
    }
    if (!payload.sid) {
      throw new UnauthorizedException('Invalid access token');
    }
    return {
      id: payload.sub,
      username: payload.username,
      sessionId: payload.sid,
      expiresAt: payload.exp * 1000,
    };
  }

  /**
   * A token for watching one story, for the URL of a <video>, which cannot send headers. It
   * names no user: every signed-in user may watch every story. At least a second, at most the
   * story's remaining life.
   */
  signMedia(storyId: string, ttlSeconds: number): Promise<string> {
    return this.jwt.signAsync(
      { story: storyId },
      { audience: MEDIA_AUDIENCE, expiresIn: Math.max(Math.floor(ttlSeconds), 1) },
    );
  }

  async verifyMedia(token: string, storyId: string): Promise<void> {
    let payload: { story?: string };
    try {
      payload = await this.jwt.verifyAsync<{ story?: string }>(token, { audience: MEDIA_AUDIENCE });
    } catch {
      throw new UnauthorizedException('Invalid or expired playback link');
    }
    if (payload.story !== storyId) {
      throw new UnauthorizedException('Invalid or expired playback link');
    }
  }
}
