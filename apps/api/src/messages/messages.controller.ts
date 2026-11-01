import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { IsObjectIdPipe } from '@nestjs/mongoose';
import type { Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ListMessagesQuery, MarkReadDto, SendMessageDto } from './dto/messages.dto';
import { MessagesService } from './messages.service';

@Controller('conversations/:id')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('messages')
  history(
    @Param('id', IsObjectIdPipe) id: string,
    @Query() query: ListMessagesQuery,
    @CurrentUser() user: AuthUser,
  ) {
    return this.messages.history(id, user.id, query);
  }

  /** The fallback to the socket's message:send: 201 for a new message, 200 for a retry. */
  @Post('messages')
  async send(
    @Param('id', IsObjectIdPipe) id: string,
    @Body() body: SendMessageDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { message, created } = await this.messages.send(id, user.id, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return message;
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  read(
    @Param('id', IsObjectIdPipe) id: string,
    @Body() body: MarkReadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.messages.markRead(id, user.id, body.seq);
  }
}
