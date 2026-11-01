import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from 'node:crypto';

/** OWASP's scrypt variant with 32 MiB of memory: N = 2^15, r = 8, p = 3. */
const PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** 128 · N · r = 32 MiB, over Node's 32 MiB default, so the limit is raised explicitly. */
const MAX_MEMORY = 64 * 1024 * 1024;

/**
 * Password hashes as `scrypt$N=32768,r=8,p=3$<salt>$<key>` (base64). The parameters travel
 * with each hash, so raising them later keeps existing hashes verifiable.
 */
@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const key = await derive(password, salt, PARAMS);
    const { N, r, p } = PARAMS;
    return `scrypt$N=${N},r=${r},p=${p}$${salt.toString('base64')}$${key.toString('base64')}`;
  }

  /** False for a wrong password and for a malformed hash alike. */
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (!parsed) {
      return false;
    }
    const actual = await derive(password, parsed.salt, parsed.params);
    return actual.length === parsed.key.length && timingSafeEqual(actual, parsed.key);
  }
}

function derive(password: string, salt: Buffer, params: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFKC: the same password typed on different devices yields the same bytes.
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_LENGTH,
      { ...params, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

function parse(stored: string): { params: ScryptOptions; salt: Buffer; key: Buffer } | null {
  const [algorithm, rawParams, salt, key, ...rest] = stored.split('$');
  if (algorithm !== 'scrypt' || !rawParams || !salt || !key || rest.length > 0) {
    return null;
  }
  const params = Object.fromEntries(
    rawParams.split(',').map((pair) => {
      const [name, value] = pair.split('=');
      return [name, Number(value)];
    }),
  );
  const { N, r, p } = params;
  if (![N, r, p].every((value) => Number.isInteger(value) && value > 0)) {
    return null;
  }
  return {
    params: { N, r, p },
    salt: Buffer.from(salt, 'base64'),
    key: Buffer.from(key, 'base64'),
  };
}
