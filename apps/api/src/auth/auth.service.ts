import { Injectable, type OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { toMeDto, type MeDto } from '../users/user.mapper';
import type { User } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import type { LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

export interface AuthResponse {
  accessToken: string;
  user: MeDto;
}

/** What a sign-in or refresh hands the controller: the body, and a refresh token for the cookie. */
export interface SignedIn {
  response: AuthResponse;
  /** Absent when a racing tab refreshed first: the cookie it set is already the newest. */
  refreshToken?: string;
}

@Injectable()
export class AuthService implements OnModuleInit {
  /** Verified against for unknown emails, so both failures take the same time. */
  private dummyHash = '';

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  async onModuleInit() {
    this.dummyHash = await this.passwords.hash(randomBytes(16).toString('base64'));
  }

  async register(input: RegisterDto, userAgent?: string): Promise<SignedIn> {
    const passwordHash = await this.passwords.hash(input.password);
    const user = await this.users.create({
      email: input.email,
      username: input.username,
      passwordHash,
    });
    return this.signIn(user, userAgent);
  }

  async login(input: LoginDto, userAgent?: string): Promise<SignedIn> {
    const user = await this.users.findByEmailWithPassword(input.email);
    const valid = await this.passwords.verify(input.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.signIn(user, userAgent);
  }

  /** A new access token for the holder of a valid refresh token, who gets a new one as well. */
  async refresh(presented: string | undefined): Promise<SignedIn> {
    const outcome = await this.sessions.rotate(presented);
    const user = await this.users.findById(outcome.userId);
    if (!user) {
      await this.sessions.revoke(outcome.sessionId);
      throw new UnauthorizedException('User no longer exists');
    }
    return {
      response: await this.respond(user, outcome.sessionId),
      refreshToken: outcome.kind === 'rotated' ? outcome.refreshToken : undefined,
    };
  }

  logout(presented: string | undefined): Promise<void> {
    return this.sessions.revokeByToken(presented);
  }

  async me(userId: string): Promise<MeDto> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }
    return toMeDto(user);
  }

  private async signIn(user: User, userAgent?: string): Promise<SignedIn> {
    const { sessionId, refreshToken } = await this.sessions.start(user._id.toString(), userAgent);
    return { response: await this.respond(user, sessionId), refreshToken };
  }

  private async respond(user: User, sessionId: string): Promise<AuthResponse> {
    const accessToken = await this.tokens.sign({
      id: user._id.toString(),
      username: user.username,
      sessionId,
    });
    return { accessToken, user: toMeDto(user) };
  }
}
