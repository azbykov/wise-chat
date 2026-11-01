import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/** Who has watched which story; one document per pair, gone together with the story. */
@Schema({ collection: 'story_views', timestamps: { createdAt: true, updatedAt: false } })
export class StoryView {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  storyId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  viewerId: Types.ObjectId;

  /** The story's own expiry, so the TTL safety net below removes the view with it. */
  @Prop({ required: true })
  expiresAt: Date;

  createdAt: Date;
}

export const StoryViewSchema = SchemaFactory.createForClass(StoryView);
StoryViewSchema.index({ storyId: 1, viewerId: 1 }, { unique: true });
// The feed asks "which of these stories has this viewer seen".
StoryViewSchema.index({ viewerId: 1, storyId: 1 });
StoryViewSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });
