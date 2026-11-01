import type { User } from './user.schema';

/** What anyone signed in may see about a user. Never the email. */
export interface UserDto {
  id: string;
  username: string;
  createdAt: string;
}

/** The signed-in user about themselves. */
export interface MeDto extends UserDto {
  email: string;
}

export function toUserDto(user: Pick<User, '_id' | 'username' | 'createdAt'>): UserDto {
  return {
    id: user._id.toString(),
    username: user.username,
    createdAt: user.createdAt.toISOString(),
  };
}

export function toMeDto(user: Pick<User, '_id' | 'username' | 'createdAt' | 'email'>): MeDto {
  return { ...toUserDto(user), email: user.email };
}
