import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'load-test-results/**'] },
  // Flag `eslint-disable` comments that no longer suppress anything, so the
  // no-explicit-any ban above cannot be quietly opted out of and left behind.
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // `src/**` is `any`-free: mysql2 results use RowDataPacket/ResultSetHeader
      // generics, caught errors stay `unknown` and are narrowed via utils/httpError.
      // Kept at 'error' so the debt cannot creep back in. Tests are exempt below.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['src/**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
);
