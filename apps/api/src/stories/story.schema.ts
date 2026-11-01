import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

/** The feed shows at most this many of the newest live stories. */
export const FEED_LIMIT = 200;

/** A story lives this long; every query filters on expiresAt, so it vanishes on time. */
export const STORY_TTL_MS = 24 * 60 * 60 * 1000;

@Schema({ collection: 'stories', timestamps: { createdAt: true, updatedAt: false } })
export class Story {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  authorId: Types.ObjectId;

  /** The video's name in the storage, "<storyId>.<extension>". */
  @Prop({ required: true })
  fileName: string;

  @Prop({ required: true })
  mimeType: string;

  @Prop({ required: true })
  sizeBytes: number;

  /** As the recorder measured it; the server does not probe videos (the brief rules it out). */
  @Prop({ required: true })
  durationMs: number;

  @Prop({ required: true })
  expiresAt: Date;

  createdAt: Date;
}

export type StoryDocument = HydratedDocument<Story>;
export const StorySchema = SchemaFactory.createForClass(Story);
// A safety net an hour after expiry: the cleanup job deletes the file and the document before
// that. The TTL monitor alone would leave the file on disk.
StorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
StorySchema.index({ authorId: 1, expiresAt: -1 });
