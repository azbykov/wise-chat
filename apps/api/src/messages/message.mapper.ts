import type { Message } from './message.schema';

export interface MessageDto {
  id: string;
  conversationId: string;
  seq: number;
  senderId: string;
  text: string;
  clientMessageId: string;
  createdAt: string;
}

export function toMessageDto(message: Message): MessageDto {
  return {
    id: message._id.toString(),
    conversationId: message.conversationId.toString(),
    seq: message.seq,
    senderId: message.senderId.toString(),
    text: message.text,
    clientMessageId: message.clientMessageId,
    createdAt: message.createdAt.toISOString(),
  };
}
