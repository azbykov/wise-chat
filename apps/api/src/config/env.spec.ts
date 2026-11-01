import { validateEnv } from './env';

describe('validateEnv', () => {
  const valid = {
    MONGO_URI: 'mongodb://127.0.0.1:27017/chat?directConnection=true',
    CORS_ORIGIN: 'http://localhost:5173',
    JWT_SECRET: 'x'.repeat(32),
  };

  it('accepts a complete environment and fills in the defaults', () => {
    expect(validateEnv(valid)).toMatchObject({
      ...valid,
      PORT: 3000,
      JWT_EXPIRES_IN: '15m',
      REFRESH_TOKEN_TTL_DAYS: 30,
      REFRESH_REUSE_GRACE_SECONDS: 10,
      COOKIE_SECURE: false,
      AUTH_RATE_LIMIT_PER_MINUTE: 10,
    });
  });

  it('turns numeric variables into numbers', () => {
    const env = validateEnv({ ...valid, PORT: '4000', AUTH_RATE_LIMIT_PER_MINUTE: '30' });
    expect(env.PORT).toBe(4000);
    expect(env.AUTH_RATE_LIMIT_PER_MINUTE).toBe(30);
  });

  it('names every missing or invalid variable', () => {
    const message = (() => {
      try {
        validateEnv({ MONGO_URI: 'postgres://db', PORT: '0', JWT_SECRET: 'short' });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();
    for (const name of ['MONGO_URI', 'PORT', 'CORS_ORIGIN', 'JWT_SECRET']) {
      expect(message).toContain(name);
    }
  });

  it('rejects a token lifetime without a unit', () => {
    expect(() => validateEnv({ ...valid, JWT_EXPIRES_IN: '3600' })).toThrow('JWT_EXPIRES_IN');
  });
});
