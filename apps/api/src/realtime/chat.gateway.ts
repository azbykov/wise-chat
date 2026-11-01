import {
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
  UseFilters,
  UsePipes,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { AuthUser } from '../auth/current-user.decorator';
import { SessionService } from '../auth/session.service';
import { TokenExpiredException, TokenService } from '../auth/token.service';
import { createValidationPipe } from '../common/validation';
import type { MessageDto } from '../messages/message.mapper';
import { MessagesService, type ReadResult } from '../messages/messages.service';
import { ReadEvent, SendMessageEvent } from './dto/socket.dto';
import { RealtimeService, sessionRoom, userRoom } from './realtime.service';
import { SocketRateLimiter } from './socket-rate-limiter';
import { WsAckExceptionFilter, type Ack } from './ws-ack-exception.filter';

/** Why a handshake was refused, in `err.data.code` on the client's connect_error. */
export const SOCKET_ERROR = {
  unauthorized: 'UNAUTHORIZED',
  tokenExpired: 'TOKEN_EXPIRED',
  /** The check itself failed (the database is down): the session may be fine, try again. */
  unavailable: 'UNAVAILABLE',
} as const;

type ChatSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  { user: AuthUser; expiresAt: number }
>;

const LIMITS_PER_SECOND = { 'message:send': 10, 'conversation:read': 10 };

@WebSocketGateway()
@UsePipes(createValidationPipe())
@UseFilters(WsAckExceptionFilter)
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChatGateway.name);
  private readonly limiter = new SocketRateLimiter();
  /** Closes each socket when its access token runs out; the client reconnects with a new one. */
  private readonly expiry = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly messages: MessagesService,
    private readonly realtime: RealtimeService,
  ) {}

  /** The token is checked once, at the handshake; a refused socket never connects. */
  afterInit(server: Server) {
    this.realtime.attach(server);
    server.use((socket: ChatSocket, next) => {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== 'string' || token.length === 0) {
        return next(refusal(SOCKET_ERROR.unauthorized));
      }
      this.tokens
        .verify(token)
        // A token outlives its session by up to its lifetime; a socket must not.
        .then(async (claims) => {
          if (!(await this.sessions.exists(claims.sessionId))) {
            throw new UnauthorizedException('Session ended');
          }
          return claims;
        })
        .then(({ expiresAt, ...user }) => {
          socket.data.user = user;
          socket.data.expiresAt = expiresAt;
          next();
        })
        .catch((error: unknown) => next(refusal(this.refusalCode(error))));
    });
  }

  /** Only a verdict on the token or the session signs the user out; a failed check does not. */
  private refusalCode(error: unknown): string {
    if (error instanceof TokenExpiredException) return SOCKET_ERROR.tokenExpired;
    if (error instanceof UnauthorizedException) return SOCKET_ERROR.unauthorized;
    this.logger.error('Socket handshake failed', error instanceof Error ? error.stack : error);
    return SOCKET_ERROR.unavailable;
  }

  /** Every socket of a user joins their room: one emit reaches all their tabs. */
  async handleConnection(socket: ChatSocket) {
    await socket.join([userRoom(socket.data.user.id), sessionRoom(socket.data.user.sessionId)]);
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.expiresAt - Date.now()),
    );
    timer.unref();
    this.expiry.set(socket.id, timer);
    this.logger.log(`Socket ${socket.id} connected for ${socket.data.user.username}`);
  }

  handleDisconnect(socket: ChatSocket) {
    clearTimeout(this.expiry.get(socket.id));
    this.expiry.delete(socket.id);
    this.limiter.forget(socket.id);
  }

  @SubscribeMessage('message:send')
  async send(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() body: SendMessageEvent,
  ): Promise<Ack<MessageDto>> {
    this.throttle(socket, 'message:send');
    const { message } = await this.messages.send(body.conversationId, socket.data.user.id, body);
    return { ok: true, data: message };
  }

  @SubscribeMessage('conversation:read')
  async read(
    @ConnectedSocket() socket: ChatSocket,
    @MessageBody() body: ReadEvent,
  ): Promise<Ack<ReadResult>> {
    this.throttle(socket, 'conversation:read');
    const data = await this.messages.markRead(body.conversationId, socket.data.user.id, body.seq);
    return { ok: true, data };
  }

  private throttle(socket: ChatSocket, event: keyof typeof LIMITS_PER_SECOND) {
    if (!this.limiter.take(socket.id, event, LIMITS_PER_SECOND[event])) {
      throw new HttpException('Too many events, slow down', HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

function refusal(code: string): Error {
  return Object.assign(new Error(code), { data: { code } });
}
