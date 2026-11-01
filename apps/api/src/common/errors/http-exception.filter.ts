import { type ArgumentsHost, Catch, type ExceptionFilter, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { type ApiError, toApiError } from './to-api-error';

/** Every HTTP error leaves the API as an ApiError; unexpected ones are logged, never exposed. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }
    const http = host.switchToHttp();
    const { id } = http.getRequest<Request>();
    const error: ApiError = { ...toApiError(exception), ...(id && { requestId: id }) };
    if (error.statusCode >= 500) {
      this.logger.error(
        `[${id}] ${exception instanceof Error ? exception.stack : String(exception)}`,
      );
    } else {
      this.logger.warn(`[${id}] ${error.statusCode} ${error.message}`);
    }
    http.getResponse<Response>().status(error.statusCode).json(error);
  }
}
