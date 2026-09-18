import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    linterOptions: {
      // Every `eslint-disable` left in the tree is justified in a comment beside it.
      // If one stops being needed, that's a signal the underlying issue is fixed —
      // fail rather than let stale suppressions accumulate.
      reportUnusedDisableDirectives: 'error',
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Remaining: 8, each a context/provider file that also exports its `useX()` hook
      // (plus gtacpr/ConfirmDialog's `useConfirm`). Splitting the hook out is mechanical
      // but rewrites imports in ~20-40 call sites per file, so it belongs in its own
      // change rather than a typing pass.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // --- Typing debt (see docs/AUDIT_2026-09-17.md). The 2026-09-18 pass cleared
      // ~660 of the ~714 warnings; rules at zero are now errors so they stay there.

      // Remaining: 10, all inside the four vendor-invoice screens that were being
      // rewritten in parallel and so were out of scope for this pass. Zero everywhere
      // else — promote to 'error' as soon as those four land.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],

      // --- React Compiler-era hook rules (eslint-plugin-react-hooks 6).

      // Remaining: 7, all inside the four vendor-invoice screens (see above).
      'react-hooks/exhaustive-deps': 'warn',

      // Remaining: 29. These are overwhelmingly legitimate "fetch on mount" and
      // "reset local form state when a dialog's props change" effects, each carrying
      // a scoped eslint-disable and a one-line justification. Clearing the rest means
      // moving those screens onto the query layer / a remount `key`, which is a
      // behaviour change rather than a typing fix. Deliberately still a warning.
      'react-hooks/set-state-in-effect': 'warn',

      'react-hooks/error-boundaries': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/purity': 'error',
      'react-hooks/preserve-manual-memoization': 'error',
      'react-hooks/rules-of-hooks': 'error',

      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/__tests__/**', '**/*.test.{ts,tsx}', 'src/test/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.vitest } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },
  {
    files: ['*.config.{ts,js}', 'vite.config.*.ts'],
    languageOptions: { globals: globals.node },
  },
);
