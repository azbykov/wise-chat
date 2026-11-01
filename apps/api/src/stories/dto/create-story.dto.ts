import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/** 15 seconds of browser-recorded video is a few megabytes; this leaves room. */
export const STORY_MAX_BYTES = 20 * 1024 * 1024;
/** 15 s plus the recorder's own slack. */
export const STORY_MAX_DURATION_MS = 15_500;

export class CreateStoryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STORY_MAX_DURATION_MS, { message: 'A story can be at most 15 seconds long' })
  durationMs: number;
}
