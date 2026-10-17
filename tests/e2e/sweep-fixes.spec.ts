/**
 * E2E: the screens fixed in the 2026-10-17 code sweep (Rounds 2–4).
 *
 * Several of these called endpoints that never existed, so they were broken for
 * months without any test noticing. Each check opens the real screen on staging
 * and asserts the request it makes succeeds and the screen shows its content.
 *
 * Read-only: nothing here creates, changes or deletes data. Dialogs are closed.
 * One login per role (loginAs spaces logins for the API's rate limit).
 */
import { test, expect, type BrowserContext, type Page, type Response } from '@playwright/test';
import { loginAs, USERS } from './fixtures';

/** Wait for the first API response whose URL contains `fragment` (and optionally matches `when`). */
function apiResponse(pg: Page, fragment: string, when: (r: Response) => boolean = () => true) {
  return pg.waitForResponse((r) => r.url().includes(`/api/v1${fragment}`) && when(r), { timeout: 60000 });
}

/** Open a portal page with a fresh load and wait for an API call it makes. */
async function openAndWaitFor(pg: Page, path: string, fragment: string) {
  const [res] = await Promise.all([apiResponse(pg, fragment), pg.goto(path, { waitUntil: 'domcontentloaded' })]);
  return res;
}

function asRole(role: keyof typeof USERS, body: (getPage: () => Page) => void) {
  test.describe.serial(`${role}: sweep fixes`, () => {
    let ctx: BrowserContext;
    let pg: Page;
    test.beforeAll(async ({ browser }) => {
      test.setTimeout(180000);
      ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      pg = await ctx.newPage();
      await loginAs(pg, USERS[role].username, USERS[role].password);
    });
    test.afterAll(() => ctx.close());
    test.beforeEach(() => test.setTimeout(150000));
    body(() => pg);
  });
}

// ── HR: Dashboard and Personnel called /hr-dashboard/*, which never existed ────
asRole('hr', (page) => {
  test('HR Dashboard loads its numbers', async () => {
    const pg = page();
    const res = await openAndWaitFor(pg, '/hr/dashboard', '/hr/dashboard');
    expect(res.status()).toBe(200);
    const stats = (await res.json()).data;
    expect(stats).toMatchObject({
      pendingApprovals: expect.any(Number),
      activeInstructors: expect.any(Number),
      organizations: expect.any(Number),
    });
    await expect(pg.getByText('Active Instructors').first()).toBeVisible({ timeout: 30000 });
    await expect(pg.getByText(/failed to load dashboard data/i)).toHaveCount(0);
  });

  test('HR Personnel lists instructors and organizations', async () => {
    const pg = page();
    // The screen loads both lists on open.
    const [res, orgRes] = await Promise.all([
      apiResponse(pg, '/hr/instructors'),
      apiResponse(pg, '/hr/organizations'),
      pg.goto('/hr/personnel', { waitUntil: 'domcontentloaded' }),
    ]);
    expect(res.status()).toBe(200);
    const { instructors, pagination } = (await res.json()).data;
    expect(Array.isArray(instructors)).toBe(true);
    expect(pagination).toMatchObject({ page: 1, total: expect.any(Number) });
    if (instructors.length > 0) {
      await expect(pg.getByText(instructors[0].username).first()).toBeVisible({ timeout: 30000 });
    }

    expect(orgRes.status()).toBe(200);
    const { organizations } = (await orgRes.json()).data;
    await pg.getByRole('tab', { name: 'Organizations' }).click();
    if (organizations.length > 0) {
      await expect(pg.getByText(organizations[0].name).first()).toBeVisible({ timeout: 30000 });
    }
    await expect(pg.getByText(/failed to load/i)).toHaveCount(0);
  });

  test('HR user details never include password or MFA fields', async () => {
    const pg = page();
    await openAndWaitFor(pg, '/hr/personnel', '/hr/instructors');
    const view = pg.getByText('View', { exact: true }).first();
    if (!(await view.isVisible().catch(() => false))) test.skip(true, 'No instructors on staging');
    const [res] = await Promise.all([apiResponse(pg, '/hr/user/'), view.click()]);
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).not.toMatch(/password|reset_token|mfa_secret|mfa_backup/i);
    await expect(pg.getByText('User Profile Details')).toBeVisible();
    await pg.getByRole('button', { name: 'Close' }).click();
  });

  test('Payroll month picker filters by month and year', async () => {
    const pg = page();
    await openAndWaitFor(pg, '/hr/payroll', '/payroll/payments');
    const [res] = await Promise.all([
      apiResponse(pg, '/payroll/payments', (r) => r.url().includes('month=2026-03')),
      pg.getByLabel('Month').fill('2026-03'),
    ]);
    expect(res.status()).toBe(200);
  });
});

// ── Course Admin: Instructor Fairness Dashboard (new) and paged course lists ──
asRole('courseadmin', (page) => {
  test('Instructor Fairness Dashboard shows totals and the instructor table', async () => {
    const pg = page();
    const res = await openAndWaitFor(pg, '/admin/instructors', '/admin/instructor-stats');
    expect(res.status()).toBe(200);
    const { stats, summary } = (await res.json()).data;
    expect(Array.isArray(stats)).toBe(true);
    expect(summary).toMatchObject({ totalInstructors: stats.length });
    await expect(pg.getByText('Instructor Fairness Dashboard')).toBeVisible({ timeout: 30000 });
    await expect(pg.getByText('Workload Status', { exact: true })).toBeVisible();
    await expect(pg.getByText(/failed to fetch dashboard data/i)).toHaveCount(0);
  });

  test('Pending and completed course lists load 25 at a time', async () => {
    const pg = page();
    const [pending, completed] = await Promise.all([
      apiResponse(pg, '/courses/pending', (r) => r.url().includes('limit=25')),
      apiResponse(pg, '/courses/completed', (r) => r.url().includes('limit=25')),
      pg.goto('/admin/instructors', { waitUntil: 'domcontentloaded' }),
    ]);
    for (const res of [pending, completed]) {
      expect(res.status()).toBe(200);
      expect((await res.json()).pagination).toMatchObject({ page: 1, limit: 25 });
    }
    await expect(pg.getByRole('button', { name: 'Refresh' }).first()).toBeVisible();
    await expect(pg.getByText(/real-time updates are currently using polling/i)).toHaveCount(0);
  });
});

// ── Accounting: Financial Summary (server-side), Ready for Billing roster, hidden screen ──
asRole('accountant', (page) => {
  test('Financial Summary loads from the server', async () => {
    const pg = page();
    const res = await openAndWaitFor(pg, '/accounting/financial-summary', '/accounting/financial-summary');
    expect(res.status()).toBe(200);
    const s = (await res.json()).data;
    expect(s.money_out).toHaveProperty('instructor_payments');
    await expect(pg.getByText('Financial Summary').first()).toBeVisible({ timeout: 30000 });
  });

  test('a backwards date range shows a message and keeps the date fields', async () => {
    const pg = page();
    await openAndWaitFor(pg, '/accounting/financial-summary', '/accounting/financial-summary');
    const start = pg.getByLabel('Start Date');
    await start.fill('2099-01-01');
    await expect(pg.getByText('The start date must be on or before the end date.')).toBeVisible();
    await expect(start).toBeVisible();
    await expect(pg.getByLabel('End Date')).toBeVisible();
  });

  test('Ready for Billing opens a course roster', async () => {
    const pg = page();
    await pg.goto('/accounting/billing', { waitUntil: 'domcontentloaded' });
    const view = pg.getByRole('button', { name: 'View' }).first();
    const empty = pg.getByText('No courses ready for billing at this time.');
    await expect(view.or(empty)).toBeVisible({ timeout: 60000 });
    if (await empty.isVisible()) test.skip(true, 'No courses ready for billing on staging');

    const [res] = await Promise.all([
      apiResponse(pg, '/students', (r) => /\/courses\/\d+\/students/.test(r.url())),
      view.click(),
    ]);
    expect(res.status()).toBe(200);
    await expect(pg.getByRole('dialog')).toBeVisible();
    await pg.keyboard.press('Escape');
  });

  test('"Instructor Payments" is hidden from the sidebar', async () => {
    const pg = page();
    await pg.goto('/accounting/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(pg.getByText('Financial Dashboard').first()).toBeVisible({ timeout: 60000 });
    await expect(pg.getByText('Instructor Payments', { exact: true })).toHaveCount(0);
  });
});

// ── Sysadmin: Audit Log shows names and filters money activity ───────────────
asRole('sysadmin', (page) => {
  test('Audit Log "All money activity" returns names, not ids', async () => {
    const pg = page();
    await openAndWaitFor(pg, '/sysadmin/audit-logs', '/sysadmin/audit-logs');
    await pg.getByLabel('Entity Type').click();
    const [res] = await Promise.all([
      apiResponse(pg, '/sysadmin/audit-logs', (r) => r.url().includes('entity_type=money')),
      pg.getByRole('option', { name: 'All money activity' }).click(),
    ]);
    expect(res.status()).toBe(200);
    const rows: Array<{ user_id: number | null; username: string | null }> = (await res.json()).data;
    for (const row of rows) {
      if (row.user_id != null) expect(row.username, `audit row for user ${row.user_id}`).toBeTruthy();
    }
  });
});

// ── Instructor: Payment History tab hidden ───────────────────────────────────
asRole('instructor', (page) => {
  test('Timesheet page has no Payment History tab', async () => {
    const pg = page();
    await pg.goto('/instructor/timesheet', { waitUntil: 'domcontentloaded' });
    await expect(pg.getByRole('tab', { name: 'Submit Timesheet' })).toBeVisible({ timeout: 60000 });
    await expect(pg.getByRole('tab', { name: 'Payment History' })).toHaveCount(0);
  });
});
