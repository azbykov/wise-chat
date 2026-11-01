import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { type HydratedDocument, Types } from 'mongoose';

/** A copy of the newest message, so the conversation list needs no lookup per row. */
@Schema({ _id: false })
export class LastMessage {
  @Prop({ type: Types.ObjectId, required: true })
  id: Types.ObjectId;

  @Prop({ required: true })
  seq: number;

  @Prop({ type: Types.ObjectId, required: true })
  senderId: Types.ObjectId;

  @Prop({ required: true })
  text: string;

  @Prop({ required: true })
  createdAt: Date;
}

const LastMessageSchema = SchemaFactory.createForClass(LastMessage);

/**
 * One conversation per pair of users. `seq`, `lastMessage` and the per-user counters change only
 * inside the send and read transactions, which keep them consistent with the messages:
 * - `seq` is the highest message number, numbers have no gaps;
 * - `lastMessage` is the message with that number;
 * - `unread[u]` counts the peer's messages after `lastReadSeq[u]`.
 */
@Schema({ collection: 'conversations', timestamps: true })
export class Conversation {
  _id: Types.ObjectId;

  /** Both user ids, sorted. */
  @Prop({ type: [Types.ObjectId], required: true })
  participants: Types.ObjectId[];

  /** "<idA>:<idB>" with sorted ids: the unique index allows one conversation per pair. */
  @Prop({ required: true, unique: true })
  pairKey: string;

  /** Who opened the conversation; an empty one is listed only to them. */
  @Prop({ type: [Types.ObjectId], default: [] })
  openedBy: Types.ObjectId[];

  @Prop({ default: 0 })
  seq: number;

  @Prop({ type: LastMessageSchema, default: null })
  lastMessage: LastMessage | null;

  /** createdAt of the conversation until the first message, then of the newest message. */
  @Prop({ required: true })
  lastMessageAt: Date;

  @Prop({ type: Map, of: Number, default: {} })
  unread: Record<string, number>;

  @Prop({ type: Map, of: Number, default: {} })
  lastReadSeq: Record<string, number>;

  createdAt: Date;
  updatedAt: Date;
}

export type ConversationDocument = HydratedDocument<Conversation>;
export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ participants: 1, lastMessageAt: -1, _id: -1 });

export function pairKeyOf(a: string, b: string): string {
  return [a, b].sort().join(':');
}
