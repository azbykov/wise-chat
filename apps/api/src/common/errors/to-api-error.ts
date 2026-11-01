import { HttpException, HttpStatus } from '@nestjs/common';
import mongoose from 'mongoose';
import { STATUS_CODES } from 'node:http';

/** The one error shape of the API: REST response bodies and socket acks alike. */
export interface ApiError {
  statusCode: number;
  /** The standard name of the status, e.g. "Conflict". */
  error: string;
  message: string;
  details?: unknown;
  /** Matches the X-Request-Id response header and the log line. Set on REST responses. */
  requestId?: string;
}

const DUPLICATE_KEY = 11000;

export function isDuplicateKeyError(
  error: unknown,
): error is Error & { code: number; keyPattern?: Record<string, unknown> } {
  return error instanceof Error && (error as { code?: unknown }).code === DUPLICATE_KEY;
}

/** Maps anything thrown in a handler to ApiError. Unknown errors become a bare 500. */
export function toApiError(exception: unknown): ApiError {
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const body: Record<string, unknown> =
      typeof response === 'string' ? { message: response } : (response as Record<string, unknown>);
    const message = Array.isArray(body.message) ? body.message.join('; ') : body.message;
    return build(
      statusCode,
      typeof message === 'string' ? message : exception.message,
      body.details,
    );
  }

  if (isDuplicateKeyError(exception)) {
    return build(HttpStatus.CONFLICT, 'Resource already exists', {
      fields: Object.keys(exception.keyPattern ?? {}),
    });
  }

  if (exception instanceof mongoose.Error.CastError) {
    return build(HttpStatus.BAD_REQUEST, `Invalid value for "${exception.path}"`);
  }

  return build(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
}

function build(statusCode: number, message: string, details?: unknown): ApiError {
  return {
    statusCode,
    error: STATUS_CODES[statusCode] ?? 'Error',
    message,
    ...(details !== undefined && { details }),
  };
}
