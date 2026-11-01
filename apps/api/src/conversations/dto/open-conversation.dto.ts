import { IsMongoId } from 'class-validator';

export class OpenConversationDto {
  @IsMongoId({ message: 'userId must be a user id' })
  userId: string;
}
