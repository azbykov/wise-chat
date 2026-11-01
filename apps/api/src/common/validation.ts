import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';

export interface FieldError {
  /** Dotted path of the field, e.g. "username" or "profile.name". */
  path: string;
  message: string;
}

function flatten(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ path, message }));
    return [...own, ...flatten(error.children ?? [], path)];
  });
}

/** One pipe for HTTP bodies, queries and (later) socket payloads: errors name their fields. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) =>
      new BadRequestException({ message: 'Validation failed', details: flatten(errors) }),
  });
}
