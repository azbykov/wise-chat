import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { ConversationsModule } from './conversations/conversations.module';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { createValidationPipe } from './common/validation';
import { validateEnv, type Env } from './config/env';
import { HealthModule } from './health/health.module';
import { MessagesModule } from './messages/messages.module';
import { ChatModule } from './realtime/chat.module';
import { RealtimeModule } from './realtime/realtime.module';
import { StoriesModule } from './stories/stories.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Local development keeps one .env at the repository root; Docker passes real variables.
      envFilePath: ['../../.env'],
      validate: validateEnv,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        uri: config.get('MONGO_URI', { infer: true }),
      }),
    }),
    ScheduleModule.forRoot(),
    HealthModule,
    UsersModule,
    AuthModule,
    RealtimeModule,
    ConversationsModule,
    MessagesModule,
    ChatModule,
    StoriesModule,
  ],
  providers: [
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
