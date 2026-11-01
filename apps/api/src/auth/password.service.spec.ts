import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('verifies the right password and refuses a wrong one', async () => {
    const hash = await passwords.hash('correct horse battery staple');
    expect(await passwords.verify('correct horse battery staple', hash)).toBe(true);
    expect(await passwords.verify('correct horse battery stapler', hash)).toBe(false);
  });

  it('stores the parameters with the hash and salts every hash', async () => {
    const [a, b] = await Promise.all([passwords.hash('same'), passwords.hash('same')]);
    expect(a).toMatch(/^scrypt\$N=32768,r=8,p=3\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(a).not.toBe(b);
  });

  it('treats canonically equal Unicode passwords as one password', async () => {
    const composed = 'café';
    const decomposed = 'café';
    expect(await passwords.verify(decomposed, await passwords.hash(composed))).toBe(true);
  });

  it.each(['', 'bcrypt$whatever', 'scrypt$N=x,r=8,p=3$c2FsdA==$a2V5', 'scrypt$N=1024$c2FsdA=='])(
    'refuses a malformed hash %j instead of throwing',
    async (stored) => {
      expect(await passwords.verify('anything', stored)).toBe(false);
    },
  );
});
