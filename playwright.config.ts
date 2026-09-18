import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'https://stagecprapp.kpbc.ca';

export default defineConfig({
  testDir: './tests/e2e',
  // workflows.spec.ts drives real cross-role business transactions (creates
  // course requests, vendor invoices, payments) rather than just checking
  // screens render. It's slower, competes with every other spec for the
  // shared login rate limit, and writes real (clearly tagged) records — so
  // it's excluded from the default run CI uses on every push, and is meant
  // to be run on request: `npx playwright test tests/e2e/workflows.spec.ts`.
  testIgnore: process.env.INCLUDE_WORKFLOWS ? undefined : '**/workflows.spec.ts',
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
