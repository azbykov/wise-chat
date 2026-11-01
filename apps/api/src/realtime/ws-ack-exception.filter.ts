import { type ArgumentsHost, Catch, Logger, type WsExceptionFilter } from '@nestjs/common';
import { toApiError, type ApiError } from '../common/errors/to-api-error';

export type Ack<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/**
 * Socket handlers answer through the ack callback, so their errors do too: the client gets the
 * same ApiError as from REST, tied to the request that failed, and the connection stays open.
 */
@Catch()
export class WsAckExceptionFilter implements WsExceptionFilter {
  private readonly logger = new Logger(WsAckExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const error = toApiError(exception);
    if (error.statusCode >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : exception);
    }
    // Nest passes the ack callback after the client and the payload.
    const ack = host
      .getArgs()
      .slice(2)
      .find((arg): arg is (response: Ack<never>) => void => typeof arg === 'function');
    ack?.({ ok: false, error });
  }
}
