import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { IsObjectIdPipe } from '@nestjs/mongoose';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Public } from '../auth/public.decorator';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { DiscardUploadOnError } from './discard-upload.interceptor';
import { CreateStoryDto } from './dto/create-story.dto';
import { parseRange, UNSATISFIABLE } from './range';
import { StoriesService } from './stories.service';

@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  /** multipart/form-data: the video in "video", its length in "durationMs". */
  @Post()
  @UseInterceptors(
    // Streamed to a file by multer (see StoriesModule): the size cap stops it mid-stream, and
    // the service looks at the first bytes only, so a video never sits in memory.
    FileInterceptor('video'),
    DiscardUploadOnError,
  )
  create(
    @UploadedFile() video: Express.Multer.File | undefined,
    @Body() body: CreateStoryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.stories.create(user.id, video, body.durationMs);
  }

  @Get('feed')
  feed(@CurrentUser() user: AuthUser) {
    return this.stories.feed(user.id);
  }

  /** A short-lived link for <video src>, which cannot send an Authorization header. */
  @Get(':id/playback')
  playback(@Param('id', IsObjectIdPipe) id: string) {
    return this.stories.playback(id);
  }

  /**
   * Streams the video with HTTP Range support: browsers (Safari above all) need 206 responses
   * to play and seek. Authorized by the token in the playback link. The file never changes
   * under its id, so the id is a strong ETag, and If-Range / If-None-Match work on it.
   */
  @Public()
  @Get(':id/video')
  async video(
    @Param('id', IsObjectIdPipe) id: string,
    @Query('token') token: string | undefined,
    @Headers() headers: Record<string, string | undefined>,
    @Res() res: Response,
  ): Promise<void> {
    const story = await this.stories.findPlayable(id, token);
    const etag = `"${story._id.toString()}"`;
    const remaining = Math.floor((story.expiresAt.getTime() - Date.now()) / 1000);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', story.mimeType);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', `private, max-age=${Math.max(Math.min(remaining, 3600), 0)}`);

    if (headers['if-none-match'] === etag) {
      res.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }
    // If-Range: a stale validator means "send it all", never a mismatched slice.
    const ifRange = headers['if-range'];
    const range = ifRange && ifRange !== etag ? null : parseRange(headers.range, story.sizeBytes);

    if (range === UNSATISFIABLE) {
      res.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      res.setHeader('Content-Range', `bytes */${story.sizeBytes}`);
      res.end();
      return;
    }
    if (range) {
      res.status(HttpStatus.PARTIAL_CONTENT);
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${story.sizeBytes}`);
      res.setHeader('Content-Length', range.end - range.start + 1);
    } else {
      res.status(HttpStatus.OK);
      res.setHeader('Content-Length', story.sizeBytes);
    }
    // A viewer who skips ahead aborts the request; that is not an error worth reporting.
    await pipeline(this.stories.openVideo(story, range ?? undefined), res).catch(() => undefined);
  }

  /** The viewer has started watching; the feed marks the story as seen from now on. */
  @Post(':id/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  view(@Param('id', IsObjectIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.stories.markSeen(id, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', IsObjectIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.stories.remove(id, user.id);
  }
}
