import type { Types } from 'mongoose';
import { toUserDto, type UserDto } from '../users/user.mapper';
import type { User } from '../users/user.schema';
import type { Conversation } from './conversation.schema';

export type UsersById = Map<string, Pick<User, '_id' | 'username' | 'createdAt'>>;

export interface LastMessageDto {
  id: string;
  seq: number;
  senderId: string;
  text: string;
  createdAt: string;
}

/** A conversation as one participant sees it: their peer, their unread count. */
export interface ConversationDto {
  id: string;
  peer: UserDto;
  lastMessage: LastMessageDto | null;
  unreadCount: number;
  lastMessageAt: string;
  createdAt: string;
}

export function peerOf(conversation: Pick<Conversation, 'participants'>, userId: string): string {
  return conversation.participants.map(String).find((id) => id !== userId)!;
}

export function toConversationDto(
  conversation: Conversation,
  viewerId: string,
  usersById: UsersById,
): ConversationDto {
  const peerId = peerOf(conversation, viewerId);
  const peer = usersById.get(peerId);
  const last = conversation.lastMessage;
  return {
    id: conversation._id.toString(),
    peer: peer
      ? toUserDto(peer)
      : { id: peerId, username: 'deleted user', createdAt: conversation.createdAt.toISOString() },
    lastMessage: last
      ? {
          id: last.id.toString(),
          seq: last.seq,
          senderId: last.senderId.toString(),
          text: last.text,
          createdAt: last.createdAt.toISOString(),
        }
      : null,
    unreadCount: conversation.unread?.[viewerId] ?? 0,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
  };
}

export function idsOf(conversations: Pick<Conversation, 'participants'>[]): Types.ObjectId[] {
  return conversations.flatMap((c) => c.participants);
}
