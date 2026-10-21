/**
 * E2E: one course, followed through every role, from availability to a
 * verified payment.
 *
 *   instructor availability -> course admin sees it -> organization requests
 *   the course and uploads its roster -> course admin assigns the instructor
 *   -> instructor takes attendance and completes the class -> course admin
 *   sends it to billing -> accountant invoices, approves and posts it ->
 *   organization pays it -> accountant verifies the payment -> organization
 *   sees it paid and downloads the PDF.
 *
 * The point is the hand-offs: at each one the NEXT role's screen is checked
 * for the right data, not just that the previous call returned 200.
 *
 * It creates invoices and payments, so it only ever runs against a local
 * copy of the app (BASE_URL on localhost / 127.0.0.1) and only on request:
 *
 *   BASE_URL=http://localhost:5179 E2E_TEST_PASSWORD=... E2E_FULL_FLOW=1 \
 *     npx playwright test tests/e2e/course-to-payment.spec.ts --project=chromium
 *
 * The class has to be TODAY, because Class Attendance only lists today's
 * classes. The instructor can only teach one course a day, so this can run
 * once per day per database: a second run on the same day finds the
 * instructor already booked (see the message in step 2).
 */
import { test, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page, Response } from '@playwright/test';
import { loginAs, USERS, TEST_MARKER, getAccessToken } from './fixtures';

const baseUrl = process.env.BASE_URL || '';
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(baseUrl);

type RoleKey = 'instructor' | 'admin' | 'orguser' | 'accountant';

/** Today in the browser's (and this machine's) local time, as the app sends it. */
function localToday(): { iso: string; us: string; display: string } {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const month = d.toLocaleString('en-US', { month: 'short' });
  // formatDisplayDate in the frontend uses 'MMM d, yyyy'.
  return { iso: `${yyyy}-${mm}-${dd}`, us: `${mm}/${dd}/${yyyy}`, display: `${month} ${d.getDate()}, ${yyyy}` };
}

const money = (n: number) => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);

/** Wait for one API call (method + URL fragment) while doing `action`, and assert it succeeded. */
async function expectApiOk(
  page: Page,
  method: string,
  urlPart: string | RegExp,
  action: () => Promise<unknown>,
  timeout = 20000
): Promise<Response> {
  const matches = (r: Response) =>
    r.request().method() === method &&
    (typeof urlPart === 'string' ? r.url().includes(urlPart) : urlPart.test(r.url()));
  const [response] = await Promise.all([page.waitForResponse(matches, { timeout }), action()]);
  expect(
    response.ok(),
    `${method} ${response.url()} -> ${response.status()}: ${await response.text().catch(() => '')}`
  ).toBeTruthy();
  return response;
}

const SIDEBAR_LABELS: Record<string, string> = {
  '/admin/instructors': 'Instructor Management',
  '/organization/schedule': 'Schedule a Course',
  '/organization/courses': 'My Courses',
  '/organization/billing': 'Bills Payable',
  '/organization/paid-invoices': 'Paid Invoices',
  '/instructor/class-attendance': 'Class Attendance',
  '/accounting/billing': 'Ready for Billing',
  '/accounting/pending-approvals': 'Pending Approvals',
  '/accounting/receivables': 'Organization Receivables',
  '/accounting/history': 'Invoice History',
  '/accounting/verification': 'Payment Verification',
};

/**
 * Every tab here shares one IP, and the API allows 100 requests a minute per
 * IP (app.ts). Four people clicking through a whole course's life in two
 * minutes is far faster than real use, so track the limiter's own
 * x-ratelimit-* headers and, when the budget runs low, wait for the window
 * the server says it resets in (not a guessed sleep).
 */
const rateBudget = { remaining: 100, resetAt: 0 };
function trackRateLimit(ctx: BrowserContext): void {
  ctx.on('response', (r) => {
    const url = r.url();
    if (!url.includes('/api/v1/') || url.includes('/auth/login')) return; // login has its own bucket
    const remaining = Number(r.headers()['x-ratelimit-remaining']);
    const reset = Number(r.headers()['x-ratelimit-reset']); // seconds until the window resets
    if (Number.isFinite(remaining) && Number.isFinite(reset)) {
      rateBudget.remaining = remaining;
      rateBudget.resetAt = Date.now() + reset * 1000;
    }
  });
}
async function waitForRateBudget(page: Page, needed = 35): Promise<void> {
  const waitMs = rateBudget.resetAt - Date.now();
  if (rateBudget.remaining < needed && waitMs > 0) {
    await page.waitForTimeout(waitMs + 500);
    rateBudget.remaining = 100;
  }
}

/**
 * Open a screen the way a user would: from the sidebar when the tab is already
 * in that portal, so the SPA does not reload (a reload re-fetches the whole
 * portal). Re-opening the screen already shown clicks its own `refresh`
 * button when it has one, or reloads it.
 */
async function openScreen(page: Page, path: string, refresh?: string): Promise<void> {
  await waitForRateBudget(page);
  const current = new URL(page.url()).pathname;
  const portal = (p: string) => p.split('/')[1];
  const label = SIDEBAR_LABELS[path];
  if (current === path) {
    if (refresh) await page.locator('#main-content').getByRole('button', { name: refresh, exact: true }).first().click();
    else await page.reload();
  } else if (label && portal(current) === portal(path)) {
    await page.getByRole('navigation', { name: 'Sidebar' }).getByRole('button', { name: label, exact: true }).click();
  } else {
    await page.goto(path);
  }
  await page.waitForURL((u) => u.pathname === path, { timeout: 30000 });
}

test.describe.serial('Full flow: one course from availability to verified payment', () => {
  test.skip(process.env.E2E_FULL_FLOW !== '1', 'Set E2E_FULL_FLOW=1 to run the full course-to-payment flow.');
  test.skip(
    !isLocal,
    `course-to-payment creates invoices and payments, so it only runs against a local copy of the app ` +
      `(BASE_URL on localhost/127.0.0.1). BASE_URL is "${baseUrl || '(unset)'}" — never run it on staging or production.`
  );

  const runId = Date.now();
  const shortId = String(runId).slice(-6);
  const today = localToday();
  const location = `${TEST_MARKER} (run ${runId})`;
  const notes = `${TEST_MARKER} (run ${runId}) notes`;
  const courseTypeName = 'CPR Basic';
  const orgName = 'Test Organization';
  const students = [
    { first: 'Ava', last: `Present${shortId}`, email: `ava.${shortId}@e2e.test`, attends: true },
    { first: 'Ben', last: `Present${shortId}`, email: `ben.${shortId}@e2e.test`, attends: true },
    { first: 'Cy', last: `Absent${shortId}`, email: `cy.${shortId}@e2e.test`, attends: false },
  ];
  const paymentRef = `E2E-${runId}`;

  // Filled in as the flow goes.
  let instructorName = '';
  let courseId = 0;
  let invoiceNumber = '';
  let invoiceTotal = 0;

  // One logged-in tab per role, kept for the whole flow, so the suite logs in
  // four times instead of ten (the API allows 10 logins a minute).
  const sessions = new Map<RoleKey, { ctx: BrowserContext; page: Page }>();
  async function as(browser: Browser, role: RoleKey): Promise<Page> {
    const existing = sessions.get(role);
    if (existing) return existing.page;
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    trackRateLimit(ctx);
    const page = await ctx.newPage();
    await loginAs(page, USERS[role].username, USERS[role].password);
    sessions.set(role, { ctx, page });
    return page;
  }
  async function api(page: Page) {
    return { Authorization: `Bearer ${await getAccessToken(page)}` };
  }

  test.afterAll(async () => {
    for (const { ctx } of sessions.values()) await ctx.close();
  });

  test('1. instructor marks today available', async ({ browser }) => {
    test.setTimeout(120000);
    const pg = await as(browser, 'instructor');

    // The Availability screen is a bare calendar grid with no per-day labels,
    // so (as in workflows.spec.ts) this calls the endpoint its "Add
    // Availability" action calls, with the instructor's own token.
    const headers = await api(pg);
    const res = await pg.request.post('/api/v1/instructor/availability', { headers, data: { date: today.iso } });
    const alreadySet = res.status() === 400 && (await res.text()).includes('already exists');
    expect(res.ok() || alreadySet, `POST /instructor/availability -> ${res.status()}: ${await res.text()}`).toBeTruthy();

    const me = await pg.request.get('/api/v1/auth/me', { headers });
    expect(me.ok()).toBeTruthy();
    const user = (await me.json()).data.user;
    instructorName = [user.firstName ?? user.first_name, user.lastName ?? user.last_name].filter(Boolean).join(' ') || user.username;
    expect(instructorName).toBeTruthy();
  });

  test('2. course admin sees the instructor available today', async ({ browser }) => {
    test.setTimeout(120000);
    const pg = await as(browser, 'admin');
    await openScreen(pg, '/admin/instructors', 'Refresh');

    // The fairness dashboard above also has a row per instructor, so match the
    // availability row by its status too.
    const row = pg
      .getByRole('row')
      .filter({ hasText: instructorName })
      .filter({ hasText: today.display })
      .filter({ hasText: 'Available' });
    await expect(
      row.first(),
      `Instructor Management should list ${instructorName} on ${today.display}. If it is missing, the instructor may ` +
        `already have a course today from an earlier run (one course per instructor per day) — run once per day per DB.`
    ).toBeVisible({ timeout: 30000 });
    await expect(row.first().getByRole('button', { name: 'Remove Date' }), 'an open (Available) date can be removed').toBeVisible();
  });

  test('3a. organization requests a course for today and uploads its roster', async ({ browser }) => {
    test.setTimeout(180000);
    const pg = await as(browser, 'orguser');
    await openScreen(pg, '/organization/schedule');

    const dateField = pg.getByLabel('Scheduled Course Date');
    await expect(dateField).toBeVisible({ timeout: 30000 });
    await dateField.fill(today.us);
    await pg.keyboard.press('Escape');

    await pg.getByLabel('Course Name').click();
    await pg.getByRole('option', { name: courseTypeName, exact: true }).click();
    await pg.getByLabel('Location (Address/Room)').fill(location);
    await pg.getByLabel('# Students Registered').fill('4');
    await pg.getByLabel('Notes / Special Instructions (Optional)').fill(notes);

    const created = await expectApiOk(pg, 'POST', '/organization/course-request', () =>
      pg.getByRole('button', { name: 'Request Course Schedule' }).click()
    );
    const body = await created.json();
    courseId = Number(body?.data?.id ?? body?.data?.courseId ?? body?.id);
    expect(courseId, `course-request response should carry the new id: ${JSON.stringify(body)}`).toBeGreaterThan(0);

    // My Courses: the new request is listed, and its roster is uploaded here.
    // The Upload link is disabled on the day of a confirmed class (by design),
    // so the organization uploads while the request is still pending.
    await openScreen(pg, '/organization/courses');
    const row = pg.getByRole('row').filter({ hasText: location });
    await expect(row, 'My Courses should list the new request').toBeVisible({ timeout: 30000 });
    await expect(row).toContainText(courseTypeName);
    await expect(row).toContainText(/pending/i);

    await row.getByText('Upload', { exact: true }).click();
    const dialog = pg.getByRole('dialog').filter({ hasText: 'Upload Students' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    const csv = ['first_name,last_name,email', ...students.map((s) => `${s.first},${s.last},${s.email}`)].join('\n');
    await pg.setInputFiles('#csv-file-input', {
      name: `roster-${runId}.csv`,
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });
    await expectApiOk(pg, 'POST', `/courses/org/students/${courseId}`, () =>
      dialog.getByRole('button', { name: 'Upload', exact: true }).click()
    );
    await expect(dialog).toBeHidden({ timeout: 15000 });
  });

  test('3b. course admin sees the request (with Date Submitted) and assigns the instructor', async ({ browser }) => {
    test.setTimeout(120000);
    const pg = await as(browser, 'admin');
    await openScreen(pg, '/admin/instructors', 'Refresh');

    const row = pg.getByRole('row').filter({ hasText: location });
    await expect(row, 'Pending Course Requests should list the organization\'s request').toBeVisible({ timeout: 30000 });
    await expect(row).toContainText(orgName);
    await expect(row).toContainText(courseTypeName);
    // Columns: Date Submitted, Preferred Date, ... — Date Submitted must not be blank ("-").
    const cells = row.locator(':scope > *');
    await expect(cells.nth(0), 'Date Submitted should be filled in').toHaveText(today.display);
    await expect(cells.nth(1), 'Preferred Date should be today').toHaveText(today.display);

    await row.getByRole('button', { name: 'Assign Instructor' }).click();
    const dialog = pg.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByText(/instructor\(s\) available/i)).not.toContainText('0 instructor(s) available', {
      timeout: 15000,
    });
    await dialog.getByLabel('Available Instructors').click();
    await pg.getByRole('listbox').getByRole('option', { name: new RegExp(instructorName) }).click();
    await dialog.getByLabel('Start Time').fill('09:00');
    await dialog.getByLabel('End Time').fill('13:00');
    await expectApiOk(pg, 'PUT', `/courses/${courseId}/assign-instructor`, () =>
      dialog.getByRole('button', { name: 'Assign Instructor & Confirm Course' }).click()
    );

    // Hand-off back into Course Admin's own lists: now confirmed, with the instructor.
    const confirmedRow = pg.getByRole('row').filter({ hasText: location }).filter({ hasText: instructorName });
    await expect(confirmedRow.first(), 'the course should move to Confirmed with the instructor').toBeVisible({
      timeout: 30000,
    });
  });

  test('4. organization sees the confirmed course with its 3 students', async ({ browser }) => {
    test.setTimeout(120000);
    const pg = await as(browser, 'orguser');
    await openScreen(pg, '/organization/courses');
    const row = pg.getByRole('row').filter({ hasText: location });
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row).toContainText(/confirmed/i);
    await expect(row, 'the instructor is shown by name, not login').toContainText(instructorName);

    await row.getByRole('button', { name: `View students for ${courseTypeName}` }).click();
    const dialog = pg.getByRole('dialog').filter({ hasText: 'Students' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    for (const s of students) {
      await expect(dialog.getByText(`${s.first} ${s.last}`)).toBeVisible({ timeout: 15000 });
    }
    await dialog.getByRole('button', { name: 'Close' }).click();
  });

  test('5. instructor takes attendance (2 present, 1 absent) and completes the class', async ({ browser }) => {
    test.setTimeout(120000);
    const pg = await as(browser, 'instructor');

    const todayList = pg.waitForResponse((r) => r.url().includes('/instructor/classes/today') && r.request().method() === 'GET', {
      timeout: 30000,
    });
    await openScreen(pg, '/instructor/class-attendance');
    expect((await todayList).ok()).toBeTruthy();

    // Pick our class from "Today's Classes" (it is auto-selected when it is
    // the only one; picking it again is harmless and covers earlier runs).
    const heading = pg.getByText(`${courseTypeName} - ${orgName}`).first();
    const classSelect = pg.getByRole('combobox').first();
    await expect(classSelect, "Class Attendance should offer today's classes").toBeVisible({ timeout: 30000 });
    await classSelect.click();
    const option = pg.getByRole('option').filter({ hasText: location });
    await expect(option, "today's class should be offered with its course name and organization").toContainText(
      `${courseTypeName} - ${orgName}`
    );
    await option.click();
    await expect(heading, 'the selected class should show the course name and organization').toBeVisible({
      timeout: 15000,
    });
    await expect(pg.getByText(location).first()).toBeVisible();

    for (const s of students) {
      await expect(pg.getByText(`${s.first} ${s.last}`)).toBeVisible({ timeout: 15000 });
    }
    for (const s of students) {
      const label = `Mark ${s.first} ${s.last} ${s.attends ? 'present' : 'absent'}`;
      await expectApiOk(pg, 'PUT', /\/attendance$/, () => pg.getByRole('button', { name: label }).click());
      await expect(pg.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 });
    }
    await expect(pg.getByText('2 Present')).toBeVisible();
    await expect(pg.getByText('1 Absent')).toBeVisible();

    await pg.getByRole('button', { name: 'Complete Class' }).click();
    const dialog = pg.getByRole('dialog').filter({ hasText: 'Are you sure you want to mark this class as completed?' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expectApiOk(pg, 'POST', `/instructor/classes/${courseId}/complete`, () =>
      dialog.getByRole('button', { name: 'Complete Class' }).click()
    );
    await expect(pg.getByText(/Class completed successfully/)).toBeVisible({ timeout: 15000 });
  });

  test('6. course admin sees the completed course, its attendance, and sends it to billing', async ({ browser }) => {
    test.setTimeout(120000);
    const pg = await as(browser, 'admin');
    await openScreen(pg, '/admin/instructors', 'Refresh');

    const row = pg.getByRole('row').filter({ hasText: location }).filter({ has: pg.getByRole('button', { name: 'Send to Billing' }) });
    await expect(row, 'Completed Courses should list the course').toBeVisible({ timeout: 30000 });
    await expect(row).toContainText(orgName);
    await expect(row, 'the instructor is shown by name, not login').toContainText(instructorName);
    await expect(row).toContainText('Completed');

    await row.getByRole('button', { name: 'View Students' }).click();
    const studentsDialog = pg.getByRole('dialog');
    await expect(studentsDialog).toBeVisible({ timeout: 15000 });
    for (const s of students) {
      const line = studentsDialog.getByText(`${s.first} ${s.last}`);
      await expect(line).toBeVisible({ timeout: 15000 });
    }
    await expect(studentsDialog.getByText('Present: 2')).toBeVisible();
    await expect(studentsDialog.getByText('Absent: 1')).toBeVisible();
    await studentsDialog.getByRole('button', { name: /close/i }).first().click();
    await expect(studentsDialog).toBeHidden({ timeout: 15000 });

    await row.getByRole('button', { name: 'Send to Billing' }).click();
    const confirm = pg.getByRole('dialog').filter({ hasText: 'Send course to billing?' });
    await expect(confirm).toBeVisible({ timeout: 15000 });
    await expectApiOk(pg, 'PUT', `/courses/${courseId}/ready-for-billing`, () =>
      confirm.getByRole('button', { name: 'Send to Billing' }).click()
    );
    const sentRow = pg.getByRole('row').filter({ hasText: location }).filter({ has: pg.getByRole('button', { name: 'Sent to Billing' }) });
    await expect(sentRow, 'the row should now say Sent to Billing').toBeVisible({ timeout: 15000 });
  });

  test('7. accountant invoices, approves and posts it to the organization', async ({ browser }) => {
    test.setTimeout(180000);
    const pg = await as(browser, 'accountant');

    // The HST rate the app itself uses (public /config), not a hardcoded 13%.
    const cfg = await pg.request.get('/api/v1/config');
    expect(cfg.ok()).toBeTruthy();
    const taxRate = Number((await cfg.json()).data.taxRate);
    expect(taxRate).toBeGreaterThanOrEqual(0);
    const subtotal = 2 * 65;
    const tax = Math.round(subtotal * taxRate * 100) / 100;
    invoiceTotal = Math.round((subtotal + tax) * 100) / 100;

    // --- Ready for Billing ---
    await openScreen(pg, '/accounting/billing');
    const row = pg.getByRole('row').filter({ hasText: location });
    await expect(row, 'Ready for Billing should list the course').toBeVisible({ timeout: 30000 });
    await expect(row).toContainText(orgName);
    await expect(row).toContainText(courseTypeName);
    // Columns: Date Completed, Organization, Course Name, Location, Instructor, Students Attended, ...
    await expect(row.getByRole('cell').nth(0), 'date completed').toHaveText(today.display);
    await expect(row.getByRole('cell').nth(4), 'instructor').toHaveText(instructorName);
    await expect(row.getByRole('cell').nth(5), 'students attended').toHaveText('2');
    await expect(row).toContainText(money(65));
    await expect(row).toContainText(money(invoiceTotal));

    await row.getByRole('button', { name: 'View' }).click();
    const preview = pg.getByRole('dialog');
    await expect(preview).toBeVisible({ timeout: 15000 });
    await expect(preview.getByText('Present: 2')).toBeVisible({ timeout: 15000 });
    const created = await expectApiOk(pg, 'POST', /\/accounting\/invoices$/, () =>
      preview.getByRole('button', { name: 'Create Invoice' }).click()
    );
    const createdBody = await created.json();
    const invoice = createdBody?.data ?? createdBody;
    invoiceNumber = String(invoice?.invoice_number ?? invoice?.invoiceNumber ?? '');
    expect(invoiceNumber, `create-invoice response: ${JSON.stringify(createdBody)}`).toBeTruthy();
    expect(Number(invoice.amount)).toBeCloseTo(invoiceTotal, 2);

    // --- Pending Approvals -> Approve ---
    await openScreen(pg, '/accounting/pending-approvals');
    const pendingRow = pg.getByRole('row').filter({ hasText: invoiceNumber });
    await expect(pendingRow, 'Pending Approvals should list the new invoice').toBeVisible({ timeout: 30000 });
    await expect(pendingRow).toContainText(orgName);
    await expect(pendingRow).toContainText(courseTypeName);
    await expect(pendingRow).toContainText(money(invoiceTotal));
    await pendingRow.getByRole('button', { name: 'Review' }).click();
    const review = pg.getByRole('dialog');
    await expect(review).toBeVisible({ timeout: 15000 });
    await expectApiOk(pg, 'PUT', /\/approval$/, () => review.getByRole('button', { name: 'Approve Invoice' }).click());
    await expect(pendingRow).toBeHidden({ timeout: 15000 });

    // --- Organization Receivables -> Post to Organization ---
    await openScreen(pg, '/accounting/receivables');
    const arRow = pg.getByRole('row').filter({ hasText: invoiceNumber });
    await expect(arRow, 'Organization Receivables should list the approved invoice').toBeVisible({ timeout: 30000 });
    await expect(arRow).toContainText(orgName);
    await expect(arRow).toContainText(money(invoiceTotal)); // amount and balance due
    await arRow.getByRole('button', { name: `View details for invoice ${invoiceNumber}` }).click();
    const detail = pg.getByRole('dialog').filter({ has: pg.getByRole('button', { name: 'Post to Organization' }) });
    await expect(detail).toBeVisible({ timeout: 15000 });
    await detail.getByRole('button', { name: 'Post to Organization' }).click();
    const confirmPost = pg.getByRole('dialog').filter({ hasText: 'Post this invoice to the organization?' });
    await expect(confirmPost).toBeVisible({ timeout: 15000 });
    await expectApiOk(pg, 'PUT', /\/post-to-org$/, () => confirmPost.getByRole('button', { name: 'Post Invoice' }).click());

    // --- Invoice History shows it with number, amount and balance ---
    await openScreen(pg, '/accounting/history');
    const histRow = pg.getByRole('row').filter({ hasText: invoiceNumber });
    await expect(histRow, 'Invoice History should list the invoice').toBeVisible({ timeout: 30000 });
    await expect(histRow).toContainText(money(invoiceTotal));
  });

  test('8. organization sees the invoice in Bills Payable and pays it in full', async ({ browser }) => {
    test.setTimeout(120000);
    const pg = await as(browser, 'orguser');
    await openScreen(pg, '/organization/billing');

    const row = pg.getByRole('row').filter({ hasText: invoiceNumber });
    await expect(row, 'Bills Payable should list the posted invoice').toBeVisible({ timeout: 30000 });
    await expect(row).toContainText(courseTypeName);
    await expect(row).toContainText(location);
    await expect(row).toContainText(money(invoiceTotal));

    await row.getByRole('button', { name: `View invoice ${invoiceNumber}` }).click();
    const details = pg.getByRole('dialog').filter({ hasText: invoiceNumber });
    await expect(details).toBeVisible({ timeout: 15000 });
    await details.getByRole('button', { name: 'Submit Payment' }).click();

    const payDialog = pg.getByRole('dialog').filter({ has: pg.getByLabel('Payment Amount') });
    await expect(payDialog).toBeVisible({ timeout: 15000 });
    // The form opens pre-filled with the balance due: the full invoice total.
    await expect(payDialog.getByLabel('Payment Amount'), 'payment amount should default to the balance due').toHaveValue(
      invoiceTotal.toFixed(2)
    );
    await expect(payDialog).toContainText(`Balance Due: ${money(invoiceTotal)}`);
    await payDialog.getByRole('combobox').click(); // Payment Method (an MUI Select)
    await pg.getByRole('option', { name: 'Bank Transfer' }).click();
    await payDialog.getByLabel('Reference Number').fill(paymentRef);
    await payDialog.getByLabel('Notes').fill(`${TEST_MARKER} (run ${runId})`);
    await payDialog.getByRole('button', { name: 'Submit Payment' }).click();

    const confirm = pg.getByRole('dialog').filter({ hasText: 'Submit payment?' });
    await expect(confirm).toBeVisible({ timeout: 15000 });
    await expect(confirm).toContainText(money(invoiceTotal));
    await expectApiOk(pg, 'POST', /\/payment-submission$/, () => confirm.getByRole('button', { name: 'Submit Payment' }).click());
    await expect(pg.getByText(/Full payment submitted successfully/)).toBeVisible({ timeout: 15000 });
  });

  test('9. accountant sees the payment with the course details and verifies it', async ({ browser }) => {
    test.setTimeout(120000);
    const pg = await as(browser, 'accountant');
    await openScreen(pg, '/accounting/verification');

    const row = pg.getByRole('row').filter({ hasText: invoiceNumber });
    await expect(row, 'Payment Verification should list the submitted payment').toBeVisible({ timeout: 30000 });
    await expect(row).toContainText(orgName);
    await expect(row).toContainText(money(invoiceTotal));
    await expect(row).toContainText(paymentRef);
    await expect(row).toContainText(/BANK TRANSFER/);

    await row.getByRole('button', { name: 'View payment details' }).click();
    const dialog = pg.getByRole('dialog').filter({ hasText: 'Payment Details' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog, 'the payment should carry its course details').toContainText(courseTypeName);
    await expect(dialog).toContainText(location);
    await expect(dialog.getByText(/Present: 2/)).toBeVisible({ timeout: 15000 });
    for (const s of students) await expect(dialog.getByText(`${s.first} ${s.last}`)).toBeVisible();

    await dialog.getByRole('button', { name: 'Approve Payment' }).click();
    const confirm = pg.getByRole('dialog').filter({ hasText: 'Verify this payment?' });
    await expect(confirm).toBeVisible({ timeout: 15000 });
    await expectApiOk(pg, 'POST', /\/accounting\/payments\/\d+\/verify$/, () =>
      confirm.getByRole('button', { name: 'Verify Payment' }).click()
    );
  });

  test('10. organization sees the invoice paid and downloads its PDF', async ({ browser }) => {
    test.setTimeout(120000);
    const pg = await as(browser, 'orguser');
    await openScreen(pg, '/organization/paid-invoices');

    const row = pg.getByRole('row').filter({ hasText: invoiceNumber });
    await expect(row, 'Paid Invoices should list the invoice').toBeVisible({ timeout: 30000 });
    await expect(row).toContainText(courseTypeName);
    await expect(row).toContainText(/paid/i);
    await expect(row).toContainText(money(invoiceTotal));

    const pdf = await expectApiOk(pg, 'GET', /\/invoices\/\d+\/pdf$/, () =>
      row.getByRole('button', { name: `Download PDF for invoice ${invoiceNumber}` }).click()
    );
    expect(pdf.headers()['content-type'] ?? '').toContain('application/pdf');
    const bytes = await pdf.body();
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    // Bills Payable no longer shows a balance owing on it.
    await openScreen(pg, '/organization/billing');
    const billRow = pg.getByRole('row').filter({ hasText: invoiceNumber });
    if (await billRow.count()) {
      await expect(billRow).toContainText(/paid/i);
    }
  });
});
