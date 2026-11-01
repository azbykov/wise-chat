import type { UserDto } from '../users/user.mapper';
import type { Story } from './story.schema';

export interface StoryDto {
  id: string;
  authorId: string;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
  /** The viewer's own stories count as seen. */
  seen: boolean;
}

/** One author with their live stories, oldest first: the order they play in. */
export interface StoryFeedItem {
  author: UserDto;
  stories: StoryDto[];
}

/** A link to watch one story; relative to the API's host, short-lived. */
export interface StoryPlaybackDto {
  videoUrl: string;
  expiresAt: string;
}

export function toStoryDto(story: Story, seen = false): StoryDto {
  return {
    id: story._id.toString(),
    authorId: story.authorId.toString(),
    mimeType: story.mimeType,
    durationMs: story.durationMs,
    sizeBytes: story.sizeBytes,
    createdAt: story.createdAt.toISOString(),
    expiresAt: story.expiresAt.toISOString(),
    seen,
  };
}
