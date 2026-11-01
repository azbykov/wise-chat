import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { rm } from 'node:fs/promises';
import { catchError, type Observable, from, switchMap, throwError } from 'rxjs';

/**
 * Runs inside FileInterceptor: whatever fails after multer has written the file (validation of
 * the other fields, the service) must not leave it behind. A saved file is gone already, so
 * removing it again is harmless.
 */
@Injectable()
export class DiscardUploadOnError implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    return next.handle().pipe(
      catchError((error: unknown) => {
        const path = request.file?.path;
        if (!path) return throwError(() => error);
        return from(rm(path, { force: true })).pipe(switchMap(() => throwError(() => error)));
      }),
    );
  }
}
