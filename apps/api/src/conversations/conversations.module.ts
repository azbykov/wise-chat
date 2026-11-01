import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { Conversation, ConversationSchema } from './conversation.schema';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Conversation.name, schema: ConversationSchema }]),
    UsersModule,
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  // The model too: messages update a conversation inside their own transactions.
  exports: [ConversationsService, MongooseModule],
})
export class ConversationsModule {}
