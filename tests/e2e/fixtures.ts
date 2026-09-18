import { Page } from '@playwright/test';
import { test as base } from '@playwright/test';

// Test credentials loaded from environment (E2E_TEST_PASSWORD)
// Set in .env or CI — never hardcode passwords in source
const testPassword = process.env.E2E_TEST_PASSWORD || 'test123';

export const USERS = {
  instructor:  { username: 'instructor',  password: testPassword, portal: '/instructor/dashboard' },
  accountant:  { username: 'accountant',  password: testPassword, portal: '/accounting/dashboard' },
  sysadmin:    { username: 'sysadmin',    password: testPassword, portal: '/sysadmin/dashboard'   },
  admin:       { username: 'admin',       password: testPassword, portal: '/admin/dashboard'       },
  orguser:     { username: 'orguser',     password: testPassword, portal: '/organization/dashboard' },
  vendor:      { username: 'vendoruser',  password: testPassword, portal: '/vendor/dashboard'      },
  hr:          { username: 'hruser',      password: testPassword, portal: '/hr'                    },
  courseadmin: { username: 'courseadmin',  password: testPassword, portal: '/admin/dashboard'        },
} as const;

// The API allows 10 logins per minute per IP and the suite performs ~20 logins from
// one runner. Space them so we stay under the limit instead of tripping it and
// waiting out the window.
const LOGIN_SPACING_MS = 7000;
const RATE_LIMIT_BACKOFF_MS = 65000;

/** Log in via the login form and wait for navigation away from /login.
 *  Retries up to 3 times if rate-limited (429). */
export async function loginAs(page: Page, username: string, password: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForTimeout(LOGIN_SPACING_MS);
    await page.goto('/login');
    // Shared hosting can be slow to serve the first page load; give it time and reload once.
    try {
      await page.waitForSelector('input[name="username"]', { timeout: 45000 });
    } catch {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('input[name="username"]', { timeout: 45000 });
    }
    await page.fill('input[name="username"]', username);
    await page.fill('input[name="password"]', password);

    const [response] = await Promise.all([
      page.waitForResponse(
        resp => resp.url().includes('/auth/login') && resp.request().method() === 'POST',
        { timeout: 30000 }
      ),
      page.click('button[type="submit"]'),
    ]);

    if (response.status() === 429) {
      // Rate limited — wait out the 1-minute window and retry
      await page.waitForTimeout(RATE_LIMIT_BACKOFF_MS);
      continue;
    }

    await page.waitForURL(url => !url.pathname.includes('/login'), { timeout: 30000 });
    await page.waitForLoadState('domcontentloaded');
    return;
  }
  throw new Error(`Login as ${username} failed after 3 attempts (rate limited)`);
}

export type TestFixtures = Record<string, never>;
export const test = base;
export { expect } from '@playwright/test';

/** Marker every record created by the workflow E2E tests carries, so it is
 *  obviously safe to ignore or delete and never mistaken for a real customer's data. */
export const TEST_MARKER = 'E2E-TEST — do not use — automated workflow test, safe to delete';

/** A day comfortably outside the 11-day "locked" window used for instructor
 *  availability, in both ISO (API) and US (date-picker typing) form. */
export function farFutureDate(daysAhead = 45): { iso: string; us: string } {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return { iso: `${yyyy}-${mm}-${dd}`, us: `${mm}/${dd}/${yyyy}` };
}

/** Read the logged-in user's access token out of sessionStorage (see
 *  frontend/src/services/tokenService.ts) so a workflow test can call an API
 *  endpoint directly and reliably, on a page that has already logged in
 *  through the real login form. Used only for the one or two steps (like
 *  picking a day on a bare calendar widget with no accessible labels) where
 *  driving the actual UI control would be far more flaky than the endpoint
 *  it calls is simple. Every multi-field form is still driven through the UI. */
export async function getAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => sessionStorage.getItem('accessToken'));
  if (!token) throw new Error('No accessToken in sessionStorage — is the page logged in?');
  return token;
}

/** A tiny but structurally valid one-page PDF, good enough to pass the
 *  vendor invoice upload's file-type check without needing a real fixture file. */
export function minimalPdfBuffer(): Buffer {
  const pdf = [
    '%PDF-1.4',
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<<>>>>endobj',
    'trailer<</Root 1 0 R/Size 4>>',
    '%%EOF',
  ].join('\n');
  return Buffer.from(pdf, 'utf-8');
}
