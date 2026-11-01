import { Injectable } from '@nestjs/common';
import type { ConversationDto } from '../conversations/conversation.mapper';
import type { MessageDto } from '../messages/message.mapper';
import type { StoryDto } from '../stories/story.mapper';
import type { UserDto } from '../users/user.mapper';

/** Every event the server pushes to clients, with its payload. */
export interface ServerEvents {
  'message:new': { message: MessageDto; conversation: ConversationDto };
  'conversation:read': { conversationId: string; lastReadSeq: number; unreadCount: number };
  /** The story feed is shared by everyone, so these go to every connected user. */
  'story:created': { story: StoryDto; author: UserDto };
  'story:deleted': { storyId: string; authorId: string };
}

/** The part of a Socket.IO server this service needs. */
export interface RoomEmitter {
  to(rooms: string[]): { emit(event: string, payload: unknown): unknown };
  emit(event: string, payload: unknown): unknown;
  in(room: string): { disconnectSockets(close?: boolean): unknown };
}

/** Every socket of a user joins this room: one emit reaches all their tabs. */
export const userRoom = (userId: string) => `user:${userId}`;

/** Every socket opened with a session's access tokens joins this room, to be closed with it. */
export const sessionRoom = (sessionId: string) => `session:${sessionId}`;

/**
 * Lets services push events without knowing about the gateway. Until the gateway attaches its
 * server (and in tests that don't start one), emits go nowhere.
 */
@Injectable()
export class RealtimeService {
  private server: RoomEmitter | null = null;

  attach(server: RoomEmitter): void {
    this.server = server;
  }

  emitToUsers<E extends keyof ServerEvents>(
    userIds: string[],
    event: E,
    payload: ServerEvents[E],
  ): void {
    if (userIds.length > 0) {
      this.server?.to(userIds.map(userRoom)).emit(event, payload);
    }
  }

  /** Closes every socket of a session that has ended. */
  disconnectSession(sessionId: string): void {
    this.server?.in(sessionRoom(sessionId)).disconnectSockets(true);
  }

  emitToAll<E extends keyof ServerEvents>(event: E, payload: ServerEvents[E]): void {
    this.server?.emit(event, payload);
  }
}
