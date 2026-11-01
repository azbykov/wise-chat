import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { isDuplicateKeyError } from '../common/errors/to-api-error';
import { UsersService } from '../users/users.service';
import {
  idsOf,
  toConversationDto,
  type ConversationDto,
  type UsersById,
} from './conversation.mapper';
import { Conversation, pairKeyOf } from './conversation.schema';

@Injectable()
export class ConversationsService implements OnModuleInit {
  constructor(
    @InjectModel(Conversation.name) private readonly conversations: Model<Conversation>,
    private readonly users: UsersService,
  ) {}

  /** The collection and its unique index must exist before the first transaction touches them. */
  async onModuleInit() {
    await this.conversations.init();
  }

  /**
   * The one conversation of the pair, created on first use. A single upsert on the unique
   * pairKey: two users pressing "message" at the same moment end up in the same conversation.
   * Opening also marks it as opened by the caller, who then sees it even while it is empty.
   */
  async open(
    userId: string,
    peerId: string,
  ): Promise<{ conversation: ConversationDto; created: boolean }> {
    if (userId === peerId) {
      throw new BadRequestException('You cannot start a conversation with yourself');
    }
    if (!(await this.users.findById(peerId))) {
      throw new NotFoundException('User not found');
    }

    const me = new Types.ObjectId(userId);
    const now = new Date();
    const upsert = () =>
      this.conversations
        .findOneAndUpdate(
          { pairKey: pairKeyOf(userId, peerId) },
          {
            $addToSet: { openedBy: me },
            $setOnInsert: {
              participants: [userId, peerId].sort().map((id) => new Types.ObjectId(id)),
              seq: 0,
              lastMessage: null,
              lastMessageAt: now,
              unread: { [userId]: 0, [peerId]: 0 },
              lastReadSeq: { [userId]: 0, [peerId]: 0 },
            },
          },
          { upsert: true, returnDocument: 'after', includeResultMetadata: true, lean: true },
        )
        .exec();

    let result;
    try {
      result = await upsert();
    } catch (error) {
      // Two upserts raced and the other inserted first: this time it finds that one.
      if (!isDuplicateKeyError(error)) throw error;
      result = await upsert();
    }
    const conversation = result.value as Conversation;
    return {
      conversation: toConversationDto(conversation, userId, await this.loadUsers([conversation])),
      created: result.lastErrorObject?.updatedExisting === false,
    };
  }

  async list(userId: string): Promise<ConversationDto[]> {
    const me = new Types.ObjectId(userId);
    const docs = await this.conversations
      .find({ participants: me, $or: [{ lastMessage: { $ne: null } }, { openedBy: me }] })
      .sort({ lastMessageAt: -1, _id: -1 })
      .lean()
      .exec();
    const usersById = await this.loadUsers(docs);
    return docs.map((c) => toConversationDto(c, userId, usersById));
  }

  async getForUser(conversationId: string, userId: string): Promise<ConversationDto> {
    const conversation = await this.requireParticipant(conversationId, userId);
    return this.toDto(conversation, userId);
  }

  /** 404 for a conversation that does not exist, 403 for one the user is not part of. */
  async requireParticipant(conversationId: string, userId: string): Promise<Conversation> {
    const conversation = await this.conversations.findById(conversationId).lean().exec();
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    if (!conversation.participants.some((p) => p.equals(userId))) {
      throw new ForbiddenException('You are not a participant of this conversation');
    }
    return conversation;
  }

  async toDto(conversation: Conversation, viewerId: string): Promise<ConversationDto> {
    return toConversationDto(conversation, viewerId, await this.loadUsers([conversation]));
  }

  async loadUsers(conversations: Pick<Conversation, 'participants'>[]): Promise<UsersById> {
    const ids = [...new Set(idsOf(conversations).map(String))];
    const users = await this.users.findByIds(ids);
    return new Map(users.map((u) => [u._id.toString(), u]));
  }
}
