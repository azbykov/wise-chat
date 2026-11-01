import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { isValidObjectId, Model, Types } from 'mongoose';
import type { Env } from '../config/env';
import { RealtimeService } from '../realtime/realtime.service';
import { Session } from './session.schema';

export type RefreshOutcome =
  | { kind: 'rotated'; sessionId: string; userId: string; refreshToken: string }
  /** A second tab's refresh with the token the first just replaced: no new refresh token. */
  | { kind: 'concurrent'; sessionId: string; userId: string };

/** Why a refresh was refused, in `details.code`, so the client can tell the cases apart. */
export const SESSION_ERROR = {
  invalid: 'SESSION_INVALID',
  reused: 'SESSION_REUSED',
} as const;

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const refused = (code: string, message: string) =>
  new UnauthorizedException({ message, details: { code } });

/**
 * Refresh tokens look like `<sessionId>.<secret>`. The id finds the session, the secret proves
 * the caller holds the latest token; only the secret's hash is stored.
 */
@Injectable()
export class SessionService {
  private readonly ttlMs: number;
  private readonly graceMs: number;

  constructor(
    @InjectModel(Session.name) private readonly sessions: Model<Session>,
    private readonly realtime: RealtimeService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMs = config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1000;
    this.graceMs = config.get('REFRESH_REUSE_GRACE_SECONDS', { infer: true }) * 1000;
  }

  async start(
    userId: string,
    userAgent?: string,
  ): Promise<{ sessionId: string; refreshToken: string }> {
    const secret = newSecret();
    const now = new Date();
    const session = await this.sessions.create({
      userId: new Types.ObjectId(userId),
      tokenHash: sha256(secret),
      userAgent: userAgent?.slice(0, 256),
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + this.ttlMs),
    });
    const sessionId = session._id.toString();
    return { sessionId, refreshToken: `${sessionId}.${secret}` };
  }

  /**
   * Swaps the token for a new one. The swap is one conditional update, so of two requests with
   * the same token exactly one wins. The other is either a tab racing the first (the token was
   * replaced a moment ago: fine) or a replay of a long-gone token, which means the token leaked:
   * the whole session is ended.
   */
  async rotate(presented: string | undefined): Promise<RefreshOutcome> {
    const parsed = parse(presented);
    if (!parsed) throw refused(SESSION_ERROR.invalid, 'Invalid session');
    const { sessionId, hash } = parsed;
    const now = new Date();

    const next = newSecret();
    const rotated = await this.sessions.findOneAndUpdate(
      { _id: sessionId, tokenHash: hash, expiresAt: { $gt: now } },
      {
        $set: {
          tokenHash: sha256(next),
          previousHash: hash,
          rotatedAt: now,
          lastUsedAt: now,
          expiresAt: new Date(now.getTime() + this.ttlMs),
        },
      },
      { returnDocument: 'after' },
    );
    if (rotated) {
      return {
        kind: 'rotated',
        sessionId,
        userId: rotated.userId.toString(),
        refreshToken: `${sessionId}.${next}`,
      };
    }

    const session = await this.sessions.findById(sessionId);
    if (!session || session.expiresAt <= now) {
      throw refused(SESSION_ERROR.invalid, 'Session expired');
    }
    if (session.previousHash && equal(session.previousHash, hash)) {
      if (session.rotatedAt && now.getTime() - session.rotatedAt.getTime() <= this.graceMs) {
        return { kind: 'concurrent', sessionId, userId: session.userId.toString() };
      }
      await this.revoke(sessionId);
      throw refused(SESSION_ERROR.reused, 'Session ended: the refresh token was reused');
    }
    throw refused(SESSION_ERROR.invalid, 'Invalid session');
  }

  async exists(sessionId: string): Promise<boolean> {
    if (!isValidObjectId(sessionId)) return false;
    return (
      (await this.sessions.exists({ _id: sessionId, expiresAt: { $gt: new Date() } })) !== null
    );
  }

  /** Ends the session of whoever holds one of its tokens; quietly nothing for any other string. */
  async revokeByToken(presented: string | undefined): Promise<void> {
    const parsed = parse(presented);
    if (!parsed) return;
    const { sessionId, hash } = parsed;
    const { deletedCount } = await this.sessions.deleteOne({
      _id: sessionId,
      $or: [{ tokenHash: hash }, { previousHash: hash }],
    });
    if (deletedCount > 0) this.realtime.disconnectSession(sessionId);
  }

  /** Ends the session and closes its sockets. */
  async revoke(sessionId: string): Promise<void> {
    await this.sessions.deleteOne({ _id: sessionId });
    this.realtime.disconnectSession(sessionId);
  }
}

function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

function parse(token: string | undefined): { sessionId: string; hash: string } | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!isValidObjectId(sessionId) || sessionId.length !== 24 || secret.length === 0) return null;
  return { sessionId, hash: sha256(secret) };
}

function equal(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
