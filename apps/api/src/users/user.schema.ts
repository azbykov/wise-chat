import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'users', timestamps: { createdAt: true, updatedAt: false } })
export class User {
  _id: Types.ObjectId;

  /** Stored trimmed and lowercased; the unique index makes it case-insensitive. */
  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  email: string;

  /** As the user typed it, for display. */
  @Prop({ required: true })
  username: string;

  /** Uniqueness and search ignore case; both go through this field and its index. */
  @Prop({ required: true, unique: true })
  usernameLower: string;

  @Prop({ required: true, select: false })
  passwordHash: string;

  createdAt: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
