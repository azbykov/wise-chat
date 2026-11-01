import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../config/env';

export const REFRESH_COOKIE = 'refresh_token';

/**
 * The refresh token's cookie: invisible to scripts, never sent cross-site, and sent only to the
 * auth routes, which are the only ones that read it.
 */
@Injectable()
export class RefreshCookie {
  private readonly options: CookieOptions;
  private readonly maxAgeMs: number;

  constructor(config: ConfigService<Env, true>) {
    this.options = {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.get('COOKIE_SECURE', { infer: true }),
      path: '/api/auth',
    };
    this.maxAgeMs = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1000;
  }

  set(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, { ...this.options, maxAge: this.maxAgeMs });
  }

  clear(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.options);
  }

  read(req: Request): string | undefined {
    for (const pair of req.headers.cookie?.split(';') ?? []) {
      const index = pair.indexOf('=');
      if (index > 0 && pair.slice(0, index).trim() === REFRESH_COOKIE) {
        try {
          return decodeURIComponent(pair.slice(index + 1).trim());
        } catch {
          return undefined;
        }
      }
    }
    return undefined;
  }
}
