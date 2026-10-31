import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

export default ts.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/build/',
      '**/coverage/',
      '**/.svelte-kit/',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    files: ['apps/e2e/**/*.ts', 'loadtest/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/**/*.{ts,svelte}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['apps/web/**/*.svelte', 'apps/web/**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
);
