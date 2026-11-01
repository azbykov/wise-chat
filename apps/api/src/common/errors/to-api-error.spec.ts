import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { toApiError } from './to-api-error';

describe('toApiError', () => {
  it('keeps the status, message and details of an HttpException', () => {
    const error = toApiError(
      new BadRequestException({ message: 'Validation failed', details: [{ path: 'email' }] }),
    );
    expect(error).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: [{ path: 'email' }],
    });
  });

  it('names the status and leaves details out when there are none', () => {
    expect(toApiError(new NotFoundException('User not found'))).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'User not found',
    });
    expect(toApiError(new ConflictException()).error).toBe('Conflict');
  });

  it('turns a MongoDB duplicate key error into 409 with the fields', () => {
    const duplicate = Object.assign(new Error('E11000'), { code: 11000, keyPattern: { email: 1 } });
    expect(toApiError(duplicate)).toMatchObject({
      statusCode: 409,
      details: { fields: ['email'] },
    });
  });

  it('hides everything about an unexpected error', () => {
    expect(toApiError(new Error('connection string with a password'))).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  });
});
