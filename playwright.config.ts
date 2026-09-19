import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://stagecprapp.kpbc.ca';

export default defineConfig({
  testDir: './tests/e2e',
  // workflows.spec.ts and verify-fixes.spec.ts drive real cross-role
  // business transactions (creates course requests, vendor invoices,
  // payments) rather than just checking screens render. They're slower,
  // compete with every other spec for the shared login rate limit, and
  // write real (clearly tagged) records — so both are excluded from the
  // default run CI uses on every push, and are meant to be run on request:
  // `INCLUDE_WORKFLOWS=1 npx playwright test tests/e2e/workflows.spec.ts`
  // (or verify-fixes.spec.ts).
  testIgnore: process.env.INCLUDE_WORKFLOWS ? undefined : ['**/workflows.spec.ts', '**/verify-fixes.spec.ts'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
