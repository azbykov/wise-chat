import { IsMongoId } from 'class-validator';
import { MarkReadDto, SendMessageDto } from '../../messages/dto/messages.dto';

/** The same rules as the REST body, plus the conversation that REST takes from the path. */
export class SendMessageEvent extends SendMessageDto {
  @IsMongoId({ message: 'conversationId must be a conversation id' })
  conversationId: string;
}

export class ReadEvent extends MarkReadDto {
  @IsMongoId({ message: 'conversationId must be a conversation id' })
  conversationId: string;
}
