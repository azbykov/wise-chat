import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

/**
 * One sign-in on one device. Its refresh token rotates on every use, so the session is the whole
 * chain of tokens; replaying an old link of that chain ends it.
 */
@Schema({ collection: 'sessions', timestamps: { createdAt: true, updatedAt: false } })
export class Session {
  _id: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId, index: true })
  userId: Types.ObjectId;

  /** SHA-256 of the current refresh token; the token itself is never stored. */
  @Prop({ required: true })
  tokenHash: string;

  /** The token the current one replaced, to tell a tab's racing refresh from a stolen replay. */
  @Prop()
  previousHash?: string;

  @Prop()
  rotatedAt?: Date;

  @Prop()
  userAgent?: string;

  @Prop({ required: true })
  lastUsedAt: Date;

  /** MongoDB deletes the session itself once this passes. */
  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt: Date;

  createdAt: Date;
}

export type SessionDocument = HydratedDocument<Session>;
export const SessionSchema = SchemaFactory.createForClass(Session);
