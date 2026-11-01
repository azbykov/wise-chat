import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import type { ReadStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { TokenService } from '../auth/token.service';
import type { Env } from '../config/env';
import { RealtimeService } from '../realtime/realtime.service';
import { toUserDto } from '../users/user.mapper';
import { UsersService } from '../users/users.service';
import type { ByteRange } from './range';
import { StoryStorage } from './story-storage';
import {
  toStoryDto,
  type StoryDto,
  type StoryFeedItem,
  type StoryPlaybackDto,
} from './story.mapper';
import { StoryView } from './story-view.schema';
import { FEED_LIMIT, Story, STORY_TTL_MS } from './story.schema';
import { detectVideoType } from './video-signature';

/** The signature checks need no more than this many bytes. */
const HEAD_BYTES = 64;

async function readHead(path: string): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const { bytesRead, buffer } = await file.read(Buffer.alloc(HEAD_BYTES), 0, HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}

@Injectable()
export class StoriesService implements OnModuleInit {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    @InjectModel(Story.name) private readonly stories: Model<Story>,
    @InjectModel(StoryView.name) private readonly views: Model<StoryView>,
    private readonly storage: StoryStorage,
    private readonly users: UsersService,
    private readonly realtime: RealtimeService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onModuleInit() {
    await Promise.all([this.stories.init(), this.views.init()]);
  }

  /**
   * Stores the received file, then the document. The type comes from the file's own first
   * bytes; the duration is the recorder's, since probing videos on the server is out of scope.
   * The file is taken over on success and removed on any failure.
   */
  async create(
    authorId: string,
    upload: Pick<Express.Multer.File, 'path' | 'size'> | undefined,
    durationMs: number,
  ): Promise<StoryDto> {
    if (!upload || upload.size === 0) {
      if (upload) await rm(upload.path, { force: true });
      throw new BadRequestException('Attach the video in the "video" field');
    }
    try {
      return await this.store(authorId, upload, durationMs);
    } finally {
      // After a successful save the path is gone already; force makes that fine.
      await rm(upload.path, { force: true });
    }
  }

  private async store(
    authorId: string,
    upload: Pick<Express.Multer.File, 'path' | 'size'>,
    durationMs: number,
  ): Promise<StoryDto> {
    const type = detectVideoType(await readHead(upload.path));
    if (!type) {
      throw new UnsupportedMediaTypeException('Only WebM and MP4 videos are accepted');
    }

    const id = new Types.ObjectId();
    const fileName = `${id.toString()}.${type.extension}`;
    await this.storage.save(fileName, upload.path);
    let story: Story;
    try {
      // One moment for both, so a story lives exactly STORY_TTL_MS.
      const createdAt = new Date();
      const created = await this.stories.create({
        _id: id,
        authorId: new Types.ObjectId(authorId),
        fileName,
        mimeType: type.mimeType,
        sizeBytes: upload.size,
        durationMs,
        createdAt,
        expiresAt: new Date(createdAt.getTime() + STORY_TTL_MS),
      });
      story = created.toObject();
    } catch (error) {
      // No document, no file: an orphan would never be cleaned up.
      await this.storage.delete(fileName);
      throw error;
    }

    // The whole story and its author, so clients add it without reloading the feed.
    const author = await this.users.findById(authorId);
    if (author) {
      this.realtime.emitToAll('story:created', {
        story: toStoryDto(story),
        author: toUserDto(author),
      });
    }
    return toStoryDto(story, true);
  }

  /**
   * Authors with live stories: the viewer first, then the others by their newest story. Capped
   * at FEED_LIMIT stories, the newest ones.
   */
  async feed(viewerId: string): Promise<StoryFeedItem[]> {
    const latest = await this.stories
      .find({ expiresAt: { $gt: new Date() } })
      .sort({ expiresAt: -1 })
      .limit(FEED_LIMIT)
      .lean()
      .exec();
    if (latest.length === 0) {
      return [];
    }
    const live = latest.reverse();
    const seenIds = new Set(
      (
        await this.views
          .find({
            viewerId: new Types.ObjectId(viewerId),
            storyId: { $in: live.map((s) => s._id) },
          })
          .select('storyId')
          .lean()
          .exec()
      ).map((v) => v.storyId.toString()),
    );

    const byAuthor = new Map<string, Story[]>();
    for (const story of live) {
      const key = story.authorId.toString();
      byAuthor.set(key, [...(byAuthor.get(key) ?? []), story]);
    }
    const authors = await this.users.findByIds([...byAuthor.keys()]);
    const authorsById = new Map(authors.map((a) => [a._id.toString(), a]));

    const items: StoryFeedItem[] = [];
    for (const [authorId, stories] of byAuthor) {
      const author = authorsById.get(authorId);
      if (author) {
        items.push({
          author: toUserDto(author),
          stories: stories.map((story) =>
            toStoryDto(story, authorId === viewerId || seenIds.has(story._id.toString())),
          ),
        });
      }
    }
    const newest = (item: StoryFeedItem) => item.stories[item.stories.length - 1]!.createdAt;
    return items.sort(
      (a, b) =>
        Number(b.author.id === viewerId) - Number(a.author.id === viewerId) ||
        newest(b).localeCompare(newest(a)),
    );
  }

  async playback(storyId: string): Promise<StoryPlaybackDto> {
    const story = await this.findLive(storyId);
    const remaining = Math.floor((story.expiresAt.getTime() - Date.now()) / 1000);
    const ttl = Math.min(this.config.get('MEDIA_TOKEN_TTL_SECONDS', { infer: true }), remaining);
    const token = await this.tokens.signMedia(storyId, ttl);
    return {
      videoUrl: `/api/stories/${storyId}/video?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(Date.now() + Math.max(ttl, 1) * 1000).toISOString(),
    };
  }

  /** A live story for playback: the playback token stands in for the Authorization header. */
  async findPlayable(storyId: string, token: string | undefined): Promise<Story> {
    await this.tokens.verifyMedia(token ?? '', storyId);
    return this.findLive(storyId);
  }

  openVideo(story: Story, range?: ByteRange): ReadStream {
    return this.storage.open(story.fileName, range);
  }

  /** Idempotent: the first view counts, later ones change nothing. */
  async markSeen(storyId: string, viewerId: string): Promise<void> {
    const story = await this.findLive(storyId);
    if (story.authorId.equals(viewerId)) return;
    await this.views
      .updateOne(
        { storyId: story._id, viewerId: new Types.ObjectId(viewerId) },
        { $setOnInsert: { expiresAt: story.expiresAt } },
        { upsert: true },
      )
      .exec();
  }

  async remove(storyId: string, userId: string): Promise<void> {
    const story = await this.findLive(storyId);
    if (!story.authorId.equals(userId)) {
      throw new ForbiddenException('You can only delete your own stories');
    }
    // File first, like the cleanup: a failure in between leaves the document, so deleting again works.
    await this.storage.delete(story.fileName);
    await this.stories.deleteOne({ _id: story._id });
    await this.views.deleteMany({ storyId: story._id });
    this.realtime.emitToAll('story:deleted', { storyId, authorId: userId });
  }

  /**
   * Deletes expired stories, file first, then the document, so a failure in between leaves
   * the document to retry with. Idempotent; returns how many were removed.
   */
  async deleteExpired(now = new Date()): Promise<number> {
    const expired = await this.stories
      .find({ expiresAt: { $lte: now } })
      .lean()
      .exec();
    let removed = 0;
    for (const story of expired) {
      try {
        await this.storage.delete(story.fileName);
        await this.stories.deleteOne({ _id: story._id });
        await this.views.deleteMany({ storyId: story._id });
        removed += 1;
      } catch (error) {
        this.logger.warn(
          `Could not remove expired story ${story._id.toString()}: ${String(error)}`,
        );
      }
    }
    return removed;
  }

  /** Uploads nobody took over, from a crash mid-request; an hour is far past any live upload. */
  deleteStaleUploads(): Promise<number> {
    return this.storage.deleteStaleIncoming(60 * 60 * 1000);
  }

  private async findLive(storyId: string): Promise<Story> {
    const story = await this.stories
      .findOne({ _id: new Types.ObjectId(storyId), expiresAt: { $gt: new Date() } })
      .lean()
      .exec();
    if (!story) {
      throw new NotFoundException('Story not found');
    }
    return story;
  }
}
