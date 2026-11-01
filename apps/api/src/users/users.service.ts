import { ConflictException, Injectable, type OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter, Types } from 'mongoose';
import { escapeRegex } from '../common/escape-regex';
import { isDuplicateKeyError } from '../common/errors/to-api-error';
import { type Page, toPage } from '../common/page';
import type { ListUsersQuery } from './dto/list-users.query';
import { toUserDto, type UserDto } from './user.mapper';
import { User } from './user.schema';

export interface NewUser {
  email: string;
  username: string;
  passwordHash: string;
}

/** What a sign-up is told when one of its unique fields is already in use. */
const TAKEN = {
  email: { message: 'This email is already registered', detail: 'Already registered' },
  username: { message: 'This username is taken', detail: 'Already taken' },
} as const;

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  /** Unique indexes must exist before the first sign-up, or two equal usernames could slip in. */
  async onModuleInit() {
    await this.users.init();
  }

  async create(input: NewUser): Promise<User> {
    try {
      const created = await this.users.create({
        ...input,
        usernameLower: input.username.toLowerCase(),
      });
      return created.toObject();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // The username index is on usernameLower, so anything but email is the username.
        const field = 'email' in (error.keyPattern ?? {}) ? 'email' : 'username';
        const { message, detail } = TAKEN[field];
        throw new ConflictException({ message, details: [{ path: field, message: detail }] });
      }
      throw error;
    }
  }

  findByEmailWithPassword(email: string) {
    return this.users.findOne({ email }).select('+passwordHash').lean().exec();
  }

  findById(id: string | Types.ObjectId) {
    return this.users.findById(id).lean().exec();
  }

  findByIds(ids: Array<string | Types.ObjectId>) {
    return this.users
      .find({ _id: { $in: ids } })
      .lean()
      .exec();
  }

  /**
   * Everyone but the viewer, alphabetically. `search` is a case-insensitive substring of the
   * username; the cursor is the last usernameLower seen, unique, so pages never overlap.
   */
  async list(query: ListUsersQuery, viewerId: string): Promise<Page<UserDto>> {
    const filter: QueryFilter<User> = {
      _id: { $ne: new Types.ObjectId(viewerId) },
      ...((query.search || query.cursor) && {
        usernameLower: {
          ...(query.search && { $regex: escapeRegex(query.search.toLowerCase()) }),
          ...(query.cursor && { $gt: query.cursor }),
        },
      }),
    };

    const docs = await this.users
      .find(filter)
      .sort({ usernameLower: 1 })
      .limit(query.limit + 1)
      .lean()
      .exec();
    return toPage(docs, query.limit, toUserDto, (u) => u.usernameLower);
  }
}
