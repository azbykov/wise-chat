import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

// A client-supplied id ends up in logs and headers: only a short, plain token is accepted.
const ACCEPTED_ID = /^[\w.:-]{1,128}$/;

declare module 'http' {
  interface IncomingMessage {
    id?: string;
  }
}

/** Gives every request an id: the caller's X-Request-Id if it is sane, a fresh UUID otherwise. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.headers[REQUEST_ID_HEADER];
  const id = typeof supplied === 'string' && ACCEPTED_ID.test(supplied) ? supplied : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
