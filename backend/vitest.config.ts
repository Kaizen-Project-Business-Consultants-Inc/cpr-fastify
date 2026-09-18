import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Match the frontend: the 5s default is tight on a loaded CI runner.
    testTimeout: 20000,
    hookTimeout: 20000,
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/services/**'],
    },
  },
});
