import { escapeRegex } from './escape-regex';

describe('escapeRegex', () => {
  it.each(['a.b', '.*', '^bob$', '(x|y)', '[a-z]+', 'a\\b', 'a/b', 'a?{2}'])(
    'makes %s match only itself',
    (input) => {
      const pattern = new RegExp(`^${escapeRegex(input)}$`);
      expect(pattern.test(input)).toBe(true);
      expect(pattern.test(`${input}x`)).toBe(false);
    },
  );

  it('leaves letters, digits and underscores alone', () => {
    expect(escapeRegex('bob_42')).toBe('bob_42');
  });
});
