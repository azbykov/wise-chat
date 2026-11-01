import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';
import { ChatGateway } from './chat.gateway';
import { RealtimeModule } from './realtime.module';

/** The Socket.IO gateway; apart from RealtimeModule, which the messages module itself needs. */
@Module({
  imports: [AuthModule, MessagesModule, RealtimeModule],
  providers: [ChatGateway],
})
export class ChatModule {}
