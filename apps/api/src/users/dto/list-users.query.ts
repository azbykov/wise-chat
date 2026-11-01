import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export const USERS_PAGE_DEFAULT = 20;
export const USERS_PAGE_MAX = 50;

const emptyToUndefined = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export class ListUsersQuery {
  /** A part of the username, any case. An empty value lists everyone. */
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @Length(1, 24)
  @Matches(/^\P{Cc}*$/u, { message: 'search cannot contain control characters' })
  search?: string;

  /** usernameLower of the last user on the previous page. */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_.]{1,24}$/, { message: 'cursor is invalid' })
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(USERS_PAGE_MAX)
  limit: number = USERS_PAGE_DEFAULT;
}
