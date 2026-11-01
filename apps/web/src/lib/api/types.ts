/** Mirrors of the API's response bodies. */

export interface UserDto {
  id: string;
  username: string;
  createdAt: string;
}

export interface MeDto extends UserDto {
  email: string;
}

export interface AuthResponse {
  accessToken: string;
  user: MeDto;
}

/** One page of a cursor-paginated list. `nextCursor: null` means there is nothing further. */
export interface Page<T, C = string> {
  items: T[];
  nextCursor: C | null;
}

export interface LastMessageDto {
  id: string;
  seq: number;
  senderId: string;
  text: string;
  createdAt: string;
}

export interface ConversationDto {
  id: string;
  peer: UserDto;
  lastMessage: LastMessageDto | null;
  unreadCount: number;
  lastMessageAt: string;
  createdAt: string;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  seq: number;
  senderId: string;
  text: string;
  clientMessageId: string;
  createdAt: string;
}

export interface ReadResult {
  lastReadSeq: number;
  unreadCount: number;
}

export interface FieldError {
  path: string;
  message: string;
}

/** Events the server pushes over the socket. */
export interface MessageNewEvent {
  message: MessageDto;
  conversation: ConversationDto;
}

export interface ConversationReadEvent {
  conversationId: string;
  lastReadSeq: number;
  unreadCount: number;
}

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

/** `story:created`: everything needed to show the story without reloading the feed. */
export interface StoryCreatedEvent {
  story: StoryDto;
  author: UserDto;
}

export interface StoryDeletedEvent {
  storyId: string;
  authorId: string;
}

/** A link to watch one story; relative to the API's host, short-lived. */
export interface StoryPlaybackDto {
  videoUrl: string;
  expiresAt: string;
}

/** One author with their live stories, oldest first. */
export interface StoryFeedItem {
  author: UserDto;
  stories: StoryDto[];
}
