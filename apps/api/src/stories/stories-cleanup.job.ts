import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { StoriesService } from './stories.service';

/** Removes expired stories with their videos; the TTL index alone would leave the files. */
@Injectable()
export class StoriesCleanupJob {
  private readonly logger = new Logger(StoriesCleanupJob.name);
  private running = false;

  constructor(private readonly stories: StoriesService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    // A slow run must not overlap with the next one.
    if (this.running) return;
    this.running = true;
    try {
      const removed = await this.stories.deleteExpired();
      if (removed > 0) this.logger.log(`Removed ${removed} expired stories`);
      await this.stories.deleteStaleUploads();
    } catch (error) {
      this.logger.error(`Story cleanup failed: ${String(error)}`);
    } finally {
      this.running = false;
    }
  }
}
