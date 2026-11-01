import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export class Env {
  @Matches(/^mongodb(\+srv)?:\/\//, { message: 'MONGO_URI must be a mongodb:// connection string' })
  MONGO_URI: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /** The one browser origin allowed to call the API. */
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true })
  CORS_ORIGIN: string;

  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters long' })
  JWT_SECRET: string;

  /** Access token lifetime: a number with a unit, e.g. 15m, 12h, 1d. Logout revokes it sooner. */
  @Matches(/^\d+[smhd]$/, { message: 'JWT_EXPIRES_IN must look like 15m, 12h or 1d' })
  JWT_EXPIRES_IN: string = '15m';

  /** How long a session lasts without a refresh; every refresh starts the count again. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_DAYS: number = 30;

  /**
   * A refresh token that was replaced this many seconds ago is still honoured once more (without
   * a new token): a second tab refreshing at the same moment. Replayed later, it ends the session.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  REFRESH_REUSE_GRACE_SECONDS: number = 10;

  /** Send the refresh cookie over HTTPS only. Turn on wherever the site is served over HTTPS. */
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  COOKIE_SECURE: boolean = false;

  /** Directory for story videos; relative paths start from the API's working directory. */
  @IsString()
  UPLOADS_DIR: string = './uploads';

  /** How long a story's playback link works; it never outlives the story itself. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  MEDIA_TOKEN_TTL_SECONDS: number = 300;

  /**
   * How many reverse proxies sit in front of the API (0 = none, the default). Express then takes
   * the client address from that many X-Forwarded-For hops; never trusts more than that.
   */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  TRUST_PROXY: number = 0;

  /** Sign-in and sign-up attempts per minute from one address. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  AUTH_RATE_LIMIT_PER_MINUTE: number = 10;
}

/** Fails at startup, naming every missing or invalid variable, instead of at first use. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw);
  const errors = validateSync(env, { whitelist: true });
  if (errors.length > 0) {
    const details = errors
      .map((error) => `  ${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment:\n${details}`);
  }
  return env;
}
