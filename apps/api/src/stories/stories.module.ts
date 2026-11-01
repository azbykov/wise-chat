import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { AuthModule } from '../auth/auth.module';
import type { Env } from '../config/env';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { STORY_MAX_BYTES } from './dto/create-story.dto';
import { StoriesCleanupJob } from './stories-cleanup.job';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { StoryView, StoryViewSchema } from './story-view.schema';
import { Story, StorySchema } from './story.schema';
import { incomingDir, LocalDiskStoryStorage, StoryStorage } from './story-storage';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Story.name, schema: StorySchema },
      { name: StoryView.name, schema: StoryViewSchema },
    ]),
    AuthModule,
    UsersModule,
    RealtimeModule,
    // Uploads stream to disk next to the stored videos, never into memory.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        storage: diskStorage({
          destination: incomingDir(config),
          filename: (_req, _file, done) => done(null, randomUUID()),
        }),
        limits: { fileSize: STORY_MAX_BYTES, files: 1, fields: 2 },
      }),
    }),
  ],
  controllers: [StoriesController],
  providers: [
    StoriesService,
    StoriesCleanupJob,
    { provide: StoryStorage, useClass: LocalDiskStoryStorage },
  ],
})
export class StoriesModule {}
