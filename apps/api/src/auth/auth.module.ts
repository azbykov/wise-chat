import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../config/env';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PasswordService } from './password.service';
import { RefreshCookie } from './refresh-cookie';
import { Session, SessionSchema } from './session.schema';
import { SessionService } from './session.service';
import { TokenService } from './token.service';

@Module({
  imports: [
    UsersModule,
    RealtimeModule,
    MongooseModule.forFeature([{ name: Session.name, schema: SessionSchema }]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          // Validated in env.ts as a number with a unit, e.g. 1d.
          expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }) as JwtSignOptions['expiresIn'],
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => [
        { ttl: 60_000, limit: config.get('AUTH_RATE_LIMIT_PER_MINUTE', { infer: true }) },
      ],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    SessionService,
    RefreshCookie,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [TokenService, SessionService],
})
export class AuthModule {}
