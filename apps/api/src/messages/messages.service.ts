import {
  BadRequestException,
  ConflictException,
  Injectable,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { type ClientSession, type Connection, Model, Types } from 'mongoose';
import { isDuplicateKeyError } from '../common/errors/to-api-error';
import { type Page, toPage } from '../common/page';
import { peerOf, toConversationDto } from '../conversations/conversation.mapper';
import { Conversation } from '../conversations/conversation.schema';
import { ConversationsService } from '../conversations/conversations.service';
import { RealtimeService } from '../realtime/realtime.service';
import { toMessageDto, type MessageDto } from './message.mapper';
import { Message } from './message.schema';

export interface SendInput {
  text: string;
  clientMessageId: string;
}

export interface SendResult {
  message: MessageDto;
  /** False for a retry: the clientMessageId was already stored, nothing new was written. */
  created: boolean;
}

export interface HistoryQuery {
  before?: number;
  after?: number;
  limit: number;
}

export interface ReadResult {
  lastReadSeq: number;
  unreadCount: number;
}

@Injectable()
export class MessagesService implements OnModuleInit {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Message.name) private readonly messages: Model<Message>,
    @InjectModel(Conversation.name) private readonly conversationModel: Model<Conversation>,
    private readonly conversations: ConversationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** The collection and its unique indexes must exist before the first transaction writes to it. */
  async onModuleInit() {
    await this.messages.init();
  }

  /**
   * Stores the message and moves the conversation along — number, preview, unread counters — in
   * one transaction, then tells both participants. Concurrent sends to one conversation conflict
   * on its `seq`; the transaction helper retries the loser with the next number, so numbers stay
   * gapless and the preview always shows the newest message.
   */
  async send(conversationId: string, senderId: string, input: SendInput): Promise<SendResult> {
    const [conversation, previous] = await Promise.all([
      this.conversations.requireParticipant(conversationId, senderId),
      this.findByClientId(senderId, input.clientMessageId),
    ]);
    if (previous) {
      return this.replay(previous, conversationId);
    }

    let message: Message;
    let updated: Conversation;
    try {
      ({ message, updated } = await this.connection.transaction((session) =>
        this.append(conversation, senderId, input, session),
      ));
    } catch (error) {
      // The same retry came in over another connection and committed first.
      if (isDuplicateKeyError(error) && error.keyPattern?.clientMessageId) {
        const stored = await this.findByClientId(senderId, input.clientMessageId);
        if (stored) {
          return this.replay(stored, conversationId);
        }
      }
      throw error;
    }

    // Only after the commit: an event never announces a message that is not in the database.
    await this.broadcast(message, updated);
    return { message: toMessageDto(message), created: true };
  }

  /** `before` pages back from a seq, `after` catches up from one; neither — the newest page. */
  async history(
    conversationId: string,
    userId: string,
    query: HistoryQuery,
  ): Promise<Page<MessageDto, number>> {
    if (query.before !== undefined && query.after !== undefined) {
      throw new BadRequestException('Use either "before" or "after", not both');
    }
    await this.conversations.requireParticipant(conversationId, userId);

    // Catching up reads forward from `after`; anything else reads back from the newest end.
    const forward = query.after !== undefined;
    const seq = forward
      ? { $gt: query.after }
      : query.before !== undefined
        ? { $lt: query.before }
        : undefined;
    const docs = await this.messages
      .find({ conversationId: new Types.ObjectId(conversationId), ...(seq && { seq }) })
      .sort({ seq: forward ? 1 : -1 })
      .limit(query.limit + 1)
      .lean()
      .exec();

    // The cursor is the far end in reading order: the newest seq going forward, the oldest going
    // back — exactly what the next `after` or `before` takes. The items are always oldest first.
    const page = toPage(docs, query.limit, toMessageDto, (m) => m.seq);
    if (!forward) {
      page.items.reverse();
    }
    return page;
  }

  /**
   * Moves the user's read marker forward (never back, never past the newest message) and
   * recomputes their unread count. A transaction, so a message arriving in between is not lost
   * from the count: its increment conflicts with this write and one of them retries.
   */
  async markRead(conversationId: string, userId: string, seq: number): Promise<ReadResult> {
    const conversation = await this.conversations.requireParticipant(conversationId, userId);
    const peerId = new Types.ObjectId(peerOf(conversation, userId));

    const { read, changed } = await this.connection.transaction(async (session) => {
      const current = await this.conversationModel
        .findById(conversation._id, { seq: 1, lastReadSeq: 1, unread: 1 }, { session })
        .lean()
        .orFail()
        .exec();
      const readSoFar = current.lastReadSeq?.[userId] ?? 0;
      const target = Math.min(seq, current.seq);
      if (target <= readSoFar) {
        return {
          read: { lastReadSeq: readSoFar, unreadCount: current.unread?.[userId] ?? 0 },
          changed: false,
        };
      }
      const unreadCount =
        target === current.seq
          ? 0
          : await this.messages.countDocuments(
              { conversationId: conversation._id, seq: { $gt: target }, senderId: peerId },
              { session },
            );
      await this.conversationModel.updateOne(
        { _id: conversation._id },
        { $set: { [`lastReadSeq.${userId}`]: target, [`unread.${userId}`]: unreadCount } },
        { session },
      );
      return { read: { lastReadSeq: target, unreadCount }, changed: true };
    });

    if (changed) {
      // Every tab of the reader drops the badge, not only the one that read.
      this.realtime.emitToUsers([userId], 'conversation:read', { conversationId, ...read });
    }
    return read;
  }

  /**
   * The writes of one send: takes the next number, stores the message, moves the conversation's
   * preview and counters. Runs inside a transaction that may retry it, so it has no other effects.
   */
  private async append(
    conversation: Conversation,
    senderId: string,
    input: SendInput,
    session: ClientSession,
  ): Promise<{ message: Message; updated: Conversation }> {
    const recipientId = peerOf(conversation, senderId);
    const { seq } = await this.conversationModel
      .findOneAndUpdate(
        { _id: conversation._id },
        { $inc: { seq: 1 } },
        { returnDocument: 'after', session, projection: { seq: 1 } },
      )
      .lean()
      .orFail()
      .exec();

    const [doc] = await this.messages.create(
      [
        {
          conversationId: conversation._id,
          seq,
          senderId: new Types.ObjectId(senderId),
          text: input.text,
          clientMessageId: input.clientMessageId,
        },
      ],
      { session },
    );
    const message = doc!.toObject();

    // Returns the conversation as committed, so the broadcast needs no second read.
    const updated = await this.conversationModel
      .findOneAndUpdate(
        { _id: conversation._id },
        {
          $set: {
            lastMessage: {
              id: message._id,
              seq,
              senderId: message.senderId,
              text: message.text,
              createdAt: message.createdAt,
            },
            lastMessageAt: message.createdAt,
            [`unread.${senderId}`]: 0,
          },
          $max: { [`lastReadSeq.${senderId}`]: seq },
          $inc: { [`unread.${recipientId}`]: 1 },
        },
        { returnDocument: 'after', session },
      )
      .lean()
      .orFail()
      .exec();
    return { message, updated };
  }

  private findByClientId(senderId: string, clientMessageId: string) {
    return this.messages
      .findOne({ senderId: new Types.ObjectId(senderId), clientMessageId })
      .lean()
      .exec();
  }

  /**
   * A retry of a message that is already stored. The first attempt may have committed and then
   * lost its broadcast with its ack, so the retry delivers again; clients drop what they have.
   */
  private async replay(message: Message, conversationId: string): Promise<SendResult> {
    if (!message.conversationId.equals(conversationId)) {
      throw new ConflictException('This clientMessageId was already used in another conversation');
    }
    await this.broadcast(message);
    return { message: toMessageDto(message), created: false };
  }

  /** Each participant gets the conversation as they see it: their peer, their unread count. */
  private async broadcast(message: Message, known?: Conversation): Promise<void> {
    const conversation =
      known ?? (await this.conversationModel.findById(message.conversationId).lean().exec());
    if (!conversation) {
      return;
    }
    const usersById = await this.conversations.loadUsers([conversation]);
    const dto = toMessageDto(message);
    for (const participant of conversation.participants.map(String)) {
      // One emit per participant, not per room list: each gets their own conversation view.
      this.realtime.emitToUsers([participant], 'message:new', {
        message: dto,
        conversation: toConversationDto(conversation, participant, usersById),
      });
    }
  }
}
