import { Body, Controller, Get, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { IsObjectIdPipe } from '@nestjs/mongoose';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ConversationsService } from './conversations.service';
import { OpenConversationDto } from './dto/open-conversation.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.conversations.list(user.id);
  }

  /** 201 when the conversation was just created, 200 when it already existed. */
  @Post()
  async open(
    @Body() body: OpenConversationDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { conversation, created } = await this.conversations.open(user.id, body.userId);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return conversation;
  }

  @Get(':id')
  get(@Param('id', IsObjectIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.conversations.getForUser(id, user.id);
  }
}
