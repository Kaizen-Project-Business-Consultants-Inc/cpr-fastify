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
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // --- Typing debt (see docs/AUDIT_2026-09-17.md). Warnings so lint can run in CI
      // and gate on real errors; promote to 'error' as the counts come down.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],

      // --- React Compiler-era hook rules (eslint-plugin-react-hooks 6). Real issues, but
      // 200+ existing sites; warn until the Phase 5 component fixes land.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      // Hooks inside try/catch or conditionals — the two known offenders are
      // InvoiceUpload.tsx and AccountingDashboard.tsx (Phase 5). Warn for now.
      'react-hooks/rules-of-hooks': 'warn',

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
