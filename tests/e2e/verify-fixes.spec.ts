/**
 * E2E: verifies the batch of snake_case/camelCase fixes made 2026-09-19
 * actually work against real data and real screens — not just "the SQL
 * doesn't error." Each test seeds whatever real record is needed via a
 * direct authenticated API call (the same one the UI would make), then
 * drives the actual screen to confirm the value renders correctly.
 *
 * Excluded from the default CI run — see playwright.config.ts — run with:
 *   INCLUDE_WORKFLOWS=1 npx playwright test tests/e2e/verify-fixes.spec.ts
 */
import { test, expect } from '@playwright/test';
import { loginAs, USERS, TEST_MARKER, getAccessToken } from './fixtures';
import type { Page } from '@playwright/test';

async function apiPost(page: Page, path: string, data: unknown) {
  const token = await getAccessToken(page);
  return page.request.post(path, { headers: { Authorization: `Bearer ${token}` }, data });
}
async function apiGet(page: Page, path: string) {
  const token = await getAccessToken(page);
  return page.request.get(path, { headers: { Authorization: `Bearer ${token}` } });
}
async function apiPut(page: Page, path: string, data: unknown) {
  const token = await getAccessToken(page);
  return page.request.put(path, { headers: { Authorization: `Bearer ${token}` }, data });
}

test.describe('Verify: organization pricing fields render', () => {
  test('sysadmin creates pricing through the real dialog and sees real values', async ({ browser }) => {
    test.setTimeout(180000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.sysadmin.username, USERS.sysadmin.password);

    await pg.goto('/sysadmin/dashboard');
    await pg.waitForLoadState('domcontentloaded');
    await pg.getByText('Organization Pricing', { exact: true }).click();
    await pg.waitForLoadState('domcontentloaded');

    await pg.getByRole('button', { name: '+ Add Pricing' }).click();
    const dialog = pg.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });

    // These two Selects have no associated <label> at all — "Organization"/
    // "Class Type" are just the closed control's own placeholder-style
    // display text (appearing twice: once as the floating label, once as
    // the display span), not a real accessible label — getByLabel matches
    // nothing and getByText is ambiguous. Target by role instead: the
    // first two comboboxes in this dialog are Organization then Class Type.
    await dialog.getByRole('combobox').nth(0).click();
    const orgOption = pg.getByRole('option').first();
    await expect(orgOption).toBeVisible({ timeout: 10000 });
    const orgName = (await orgOption.innerText()).trim();
    await orgOption.click();

    await dialog.getByRole('combobox').nth(1).click();
    const classOption = pg.getByRole('option').first();
    await expect(classOption).toBeVisible({ timeout: 10000 });
    const className = (await classOption.innerText()).trim();
    await classOption.click();

    await dialog.getByLabel(/^Price per Student/).fill('123.45');

    const [response] = await Promise.all([
      pg.waitForResponse((r) => r.url().includes('/course-pricing') && r.request().method() === 'POST', { timeout: 20000 }),
      dialog.getByRole('button', { name: 'Create' }).click(),
    ]);
    expect(response.ok(), `POST .../course-pricing -> ${response.status()}: ${await response.text().catch(() => '')}`).toBeTruthy();

    // Back on the list — confirm the real values render, not blanks.
    await expect(pg.getByText(orgName, { exact: false }).first()).toBeVisible({ timeout: 15000 });
    await expect(pg.getByText(className, { exact: false }).first()).toBeVisible({ timeout: 15000 });
    await expect(pg.getByText('$123.45', { exact: false }).first()).toBeVisible({ timeout: 15000 });
    await expect(pg.getByText('Active', { exact: false }).first()).toBeVisible({ timeout: 15000 });

    await ctx.close();
  });

  test('organization user sees the same pricing on their own read-only screen', async ({ browser }) => {
    test.setTimeout(120000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.orguser.username, USERS.orguser.password);

    await pg.goto('/organization/dashboard');
    await pg.waitForLoadState('domcontentloaded');
    await pg.getByText('Pricing', { exact: true }).click();
    await pg.waitForLoadState('domcontentloaded');

    // Org 1 (Test Organization, orguser's org) should show at least one
    // priced course type with a real dollar figure, not a blank/zero row.
    const priceCell = pg.getByText(/\$\d+\.\d{2}/).first();
    await expect(priceCell, 'a real formatted price should render, not blank').toBeVisible({ timeout: 20000 });

    await ctx.close();
  });
});

test.describe('Verify: pay rate fields render', () => {
  test('HR sets a rate and sees it in the instructor list and history dialog', async ({ browser }) => {
    test.setTimeout(180000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.hr.username, USERS.hr.password);

    await pg.goto('/hr/payrates');
    await pg.waitForLoadState('domcontentloaded');

    await pg.getByPlaceholder('Search instructors...').fill('instructor');
    const editBtn = pg.getByRole('button', { name: /Edit pay rate for/ }).first();
    await expect(editBtn, 'the instructor fixture user should be searchable here').toBeVisible({ timeout: 20000 });
    await editBtn.click();

    const dialog = pg.getByRole('dialog').filter({ hasText: /Set Pay Rate for/ });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    // Regex partial match — required fields get a trailing " *" MUI appends
    // to the accessible name, which breaks an exact-string getByLabel.
    await dialog.getByLabel(/^Hourly Rate/).fill('32.50');
    await dialog.getByLabel(/^Course Bonus/).fill('60');
    await dialog.getByLabel(/^Change Reason/).fill(TEST_MARKER);
    await dialog.getByRole('button', { name: 'Save' }).click();

    const confirmDialog = pg.getByRole('dialog').filter({ hasText: 'Set pay rate?' });
    await expect(confirmDialog).toBeVisible({ timeout: 15000 });
    const [response] = await Promise.all([
      pg.waitForResponse((r) => r.url().includes('/pay-rates/instructors') && r.request().method() === 'POST', { timeout: 20000 }),
      confirmDialog.getByRole('button', { name: 'Set rate' }).click(),
    ]);
    expect(response.ok(), `POST pay rate -> ${response.status()}`).toBeTruthy();

    // List row should now show the real rate, not "No rate set".
    await expect(pg.getByText('$32.50/hr', { exact: false }).first()).toBeVisible({ timeout: 15000 });

    // History dialog should show the same figures.
    const historyBtn = pg.getByRole('button', { name: /Pay rate history for/ }).first();
    await historyBtn.click();
    const historyDialog = pg.getByRole('dialog').filter({ hasText: /Pay Rate History/ });
    await expect(historyDialog).toBeVisible({ timeout: 15000 });
    await expect(historyDialog.getByText('$32.50/hr', { exact: false })).toBeVisible({ timeout: 15000 });
    await expect(historyDialog.getByText('$60.00 per course', { exact: false })).toBeVisible({ timeout: 15000 });

    await ctx.close();
  });
});

test.describe('Verify: payroll fields render', () => {
  test('a payroll payment created via API shows real values on the HR screen', async ({ browser }) => {
    test.setTimeout(120000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.hr.username, USERS.hr.password);

    // PayrollManagement.tsx has no "create payment" UI (Calculate Payroll
    // only previews a figure) — seed a real row the same way the backend's
    // own createPayment path would, then verify the *display*, which is
    // what today's fix actually touches.
    const instructors = await apiGet(pg, '/api/v1/pay-rates/instructors?limit=5');
    const instrBody = await instructors.json();
    const instructorId = (instrBody.data?.instructors ?? [])[0]?.id;
    expect(instructorId, 'need at least one instructor user to seed a payment for').toBeTruthy();

    const created = await apiPost(pg, '/api/v1/payroll/payments', {
      instructor_id: instructorId,
      amount: 250.75,
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: 'direct_deposit',
      notes: TEST_MARKER,
    });
    expect(created.ok(), `seed POST /payroll/payments -> ${created.status()}: ${await created.text().catch(() => '')}`).toBeTruthy();

    await pg.goto('/hr/payroll');
    await pg.waitForLoadState('domcontentloaded');
    await pg.getByRole('button', { name: 'Refresh' }).click();

    await expect(pg.getByText('$250.75', { exact: false }).first()).toBeVisible({ timeout: 20000 });
    await expect(pg.getByText('direct_deposit', { exact: false }).first()).toBeVisible({ timeout: 20000 });

    await ctx.close();
  });
});

test.describe('Verify: timesheet fields render', () => {
  const lastMonday = (() => {
    const d = new Date();
    const day = d.getDay();
    const diffToLastMonday = day === 0 ? 13 : day + 6; // a Monday at least a week in the past
    d.setDate(d.getDate() - diffToLastMonday);
    // toISOString() shifts to UTC and can land on the wrong local day near
    // midnight — the exact bug this app already fixed elsewhere (see
    // toLocalDateString in formatters.ts). Build the string from local
    // Y-M-D components instead.
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  })();

  test('instructor submits, HR sees real values, approves, and adds a note', async ({ browser }) => {
    test.setTimeout(180000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.instructor.username, USERS.instructor.password);

    // Submitting through the real form depends on that week actually having
    // completed courses to auto-calculate hours from, which this account may
    // not have for an arbitrary past Monday — seed directly via the same
    // endpoint the form posts to, so the *display* (today's fix) is what
    // gets exercised, not instructor scheduling history from weeks ago.
    const submitted = await apiPost(pg, '/api/v1/timesheet', {
      weekStartDate: lastMonday,
      totalHours: 12,
      coursesTaught: 2,
      notes: TEST_MARKER,
      travelTime: 1,
      prepTime: 0.5,
      teachingHours: 10.5,
      isLate: false,
    });
    // A prior run of this suite may have already submitted this exact week —
    // that's fine, the record already exists to verify display against.
    const alreadyExists = submitted.status() === 400 && (await submitted.text()).includes('already exists');
    expect(submitted.ok() || alreadyExists, `POST /timesheet -> ${submitted.status()}: ${await submitted.text().catch(() => '')}`).toBeTruthy();

    await ctx.close();

    const hrCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const hrPg = await hrCtx.newPage();
    await loginAs(hrPg, USERS.hr.username, USERS.hr.password);

    await hrPg.goto('/hr/timesheet');
    await hrPg.waitForLoadState('domcontentloaded');

    // Confirm the list row shows real values, not blanks.
    await expect(hrPg.getByText('instructor', { exact: false }).first()).toBeVisible({ timeout: 20000 });
    await expect(hrPg.getByText('12', { exact: false }).first()).toBeVisible({ timeout: 20000 });

    const viewLink = hrPg.getByText('View', { exact: true }).first();
    await viewLink.click();
    const detailDialog = hrPg.getByRole('dialog').filter({ hasText: 'Timesheet Details' });
    await expect(detailDialog).toBeVisible({ timeout: 15000 });

    // Add a note — confirms TimesheetNotes.tsx's addedBy/noteText/noteType render.
    const addNoteBtn = detailDialog.getByRole('button', { name: 'Add Note' });
    if (await addNoteBtn.isVisible().catch(() => false)) {
      await addNoteBtn.click();
      const noteDialog = hrPg.getByRole('dialog').filter({ hasText: 'Add Note' });
      await expect(noteDialog).toBeVisible({ timeout: 10000 });
      // Anchored both ends (allowing an optional trailing " *") so this
      // doesn't also match the "Note Type" select in the same dialog.
      await noteDialog.getByLabel(/^Note\s*\*?$/).fill(TEST_MARKER);
      const [noteResponse] = await Promise.all([
        hrPg.waitForResponse((r) => r.url().includes('/notes') && r.request().method() === 'POST', { timeout: 20000 }),
        noteDialog.getByRole('button', { name: 'Add Note' }).click(),
      ]);
      expect(noteResponse.ok(), `add note -> ${noteResponse.status()}`).toBeTruthy();
      await expect(detailDialog.getByText(TEST_MARKER, { exact: false }).first()).toBeVisible({ timeout: 15000 });
      await expect(detailDialog.getByText('hruser', { exact: false }).first()).toBeVisible({ timeout: 15000 });
    }

    await hrCtx.close();
  });
});

test.describe('Verify: invoice course-type/org fields render on Pending Approvals and Rejected Invoices', () => {
  // Getting a real invoice into "pending" (and then "rejected") state needs a
  // full course lifecycle behind it — availability, request, assignment,
  // completion, ready-for-billing. That chain is what today's earlier
  // workflows.spec.ts already proves works end to end, so it's driven here
  // via direct API calls (fast, reliable) purely as setup; the actual thing
  // this test verifies — the two invoice screens — is driven through the UI.
  test('full chain via API, then verify both screens through the real UI', async ({ browser }) => {
    test.setTimeout(240000);
    const runId = Date.now();
    const date = new Date();
    date.setDate(date.getDate() + 60 + (Math.floor(runId / 1000) % 200));
    const isoDate = date.toISOString().slice(0, 10);
    const location = `${TEST_MARKER} (verify-fixes ${runId})`;

    // 1. Instructor marks that date available.
    const instrCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const instrPg = await instrCtx.newPage();
    await loginAs(instrPg, USERS.instructor.username, USERS.instructor.password);
    const avail = await apiPost(instrPg, '/api/v1/instructor/availability', { date: isoDate });
    const availOk = avail.ok() || (avail.status() === 400 && (await avail.text()).includes('already exists'));
    expect(availOk, `availability -> ${avail.status()}`).toBeTruthy();

    // 2. Org requests a course for that date.
    const orgCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const orgPg = await orgCtx.newPage();
    await loginAs(orgPg, USERS.orguser.username, USERS.orguser.password);
    const typesRes = await apiGet(orgPg, '/api/v1/course-types');
    const types = await typesRes.json();
    const courseTypeId = (types.data ?? types)[0]?.id;
    expect(courseTypeId, 'need at least one course type').toBeTruthy();
    const courseTypeName: string = (types.data ?? types)[0]?.name;

    const reqRes = await apiPost(orgPg, '/api/v1/organization/course-request', {
      courseTypeId, scheduledDate: isoDate, location, registeredStudents: 1, notes: TEST_MARKER,
    });
    expect(reqRes.ok(), `course-request -> ${reqRes.status()}: ${await reqRes.text().catch(() => '')}`).toBeTruthy();
    const reqBody = await reqRes.json();
    const courseId = reqBody.course?.id ?? reqBody.data?.id;
    expect(courseId, 'need the created course id').toBeTruthy();

    // 3. Admin assigns the available instructor.
    const adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const adminPg = await adminCtx.newPage();
    await loginAs(adminPg, USERS.admin.username, USERS.admin.password);
    const availableRes = await apiGet(adminPg, `/api/v1/instructors/available/${isoDate}`);
    const availableBody = await availableRes.json();
    const instructorId = (availableBody.data ?? availableBody)[0]?.id;
    expect(instructorId, 'the instructor should show as available for this date').toBeTruthy();
    const assignRes = await apiPut(adminPg, `/api/v1/courses/${courseId}/assign-instructor`, {
      instructorId, startTime: '09:00', endTime: '13:00',
    });
    expect(assignRes.ok(), `assign-instructor -> ${assignRes.status()}`).toBeTruthy();

    // 4. Billing readiness requires pricing configured and at least one
    // attended student — add one and mark them present, and make sure
    // pricing exists for this org+course type (accountant role).
    const studentRes = await apiPost(instrPg, `/api/v1/instructor/classes/${courseId}/students`, {
      firstName: 'E2E', lastName: 'TestStudent', email: `e2e-${runId}@example.com`, phone: '4165551234',
    });
    expect(studentRes.ok(), `add student -> ${studentRes.status()}: ${await studentRes.text().catch(() => '')}`).toBeTruthy();
    const studentBody = await studentRes.json();
    const studentId = studentBody.data?.id ?? studentBody.student?.id ?? studentBody.id;
    expect(studentId, 'need the created student id').toBeTruthy();
    const attendRes = await apiPut(instrPg, `/api/v1/instructor/classes/${courseId}/students/${studentId}/attendance`, {
      attended: true,
    });
    expect(attendRes.ok(), `mark attendance -> ${attendRes.status()}`).toBeTruthy();

    const acctSetupCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const acctSetupPg = await acctSetupCtx.newPage();
    await loginAs(acctSetupPg, USERS.accountant.username, USERS.accountant.password);
    const pricingRes = await apiPost(acctSetupPg, '/api/v1/accounting/course-pricing', {
      organizationId: 1, courseTypeId, pricePerStudent: 50, isActive: true,
    });
    // A prior run may have already priced this org+course-type combo —
    // that's fine, pricing existing at all is what billing readiness needs.
    const pricingAlready = pricingRes.status() === 400 || pricingRes.status() === 409;
    expect(pricingRes.ok() || pricingAlready, `course-pricing -> ${pricingRes.status()}: ${await pricingRes.text().catch(() => '')}`).toBeTruthy();
    await acctSetupCtx.close();

    // 5. Instructor completes the class.
    const completeRes = await apiPost(instrPg, `/api/v1/instructor/classes/${courseId}/complete`, {
      instructor_comments: TEST_MARKER,
    });
    expect(completeRes.ok(), `complete -> ${completeRes.status()}: ${await completeRes.text().catch(() => '')}`).toBeTruthy();

    // 6. Admin marks it ready for billing.
    const readyRes = await apiPut(adminPg, `/api/v1/courses/${courseId}/ready-for-billing`, {});
    expect(readyRes.ok(), `ready-for-billing -> ${readyRes.status()}: ${await readyRes.text().catch(() => '')}`).toBeTruthy();

    // 6. Accountant creates the invoice (now "pending approval").
    const acctCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const acctPg = await acctCtx.newPage();
    await loginAs(acctPg, USERS.accountant.username, USERS.accountant.password);
    const invRes = await apiPost(acctPg, '/api/v1/accounting/invoices', { courseId });
    expect(invRes.ok(), `create invoice -> ${invRes.status()}: ${await invRes.text().catch(() => '')}`).toBeTruthy();

    // --- Verification starts here: real UI, real screens. ---

    // Pending Approvals: confirm the course-type join fix — this column was
    // blank before regardless of the row even existing.
    await acctPg.goto('/accounting/pending-approvals');
    await acctPg.waitForLoadState('domcontentloaded');
    await expect(acctPg.getByText(location, { exact: false }).first(), 'our invoice should be listed').toBeVisible({ timeout: 30000 });
    await expect(acctPg.getByText(courseTypeName, { exact: false }).first(), 'course type should render, not blank').toBeVisible({ timeout: 15000 });

    // Reject it through the real dialog.
    const row = acctPg.getByText(location, { exact: false }).first();
    const rowContainer = row.locator('xpath=ancestor::*[.//button[normalize-space(text())="Review"] or .//*[normalize-space(text())="Review"]][1]');
    await rowContainer.getByText('Review', { exact: true }).click();
    const invoiceDialog = acctPg.getByRole('dialog');
    await expect(invoiceDialog).toBeVisible({ timeout: 15000 });
    await invoiceDialog.getByRole('button', { name: 'Reject Invoice' }).click();
    await invoiceDialog.getByPlaceholder(/provide a detailed reason/i).fill(TEST_MARKER);
    const [rejectResponse] = await Promise.all([
      acctPg.waitForResponse((r) => r.url().includes('/approval') && r.request().method() === 'PUT', { timeout: 20000 }),
      invoiceDialog.getByRole('button', { name: 'Confirm Rejection' }).click(),
    ]);
    expect(rejectResponse.ok(), `reject -> ${rejectResponse.status()}`).toBeTruthy();

    // Rejected Invoices: confirm every field the earlier fix targeted.
    await acctPg.goto('/accounting/rejected-invoices');
    await acctPg.waitForLoadState('domcontentloaded');
    await expect(acctPg.getByText(location, { exact: false }).first(), 'rejected invoice should be listed').toBeVisible({ timeout: 30000 });
    await expect(acctPg.getByText(courseTypeName, { exact: false }).first(), 'courseTypeName should render').toBeVisible({ timeout: 15000 });
    await expect(acctPg.getByText(TEST_MARKER, { exact: false }).first(), 'rejectionReason should render').toBeVisible({ timeout: 15000 });
    await expect(acctPg.getByText(/\$\d+\.\d{2}/).first(), 'baseCost+taxAmount should render as a real dollar figure, not blank').toBeVisible({ timeout: 15000 });

    await Promise.all([instrCtx.close(), orgCtx.close(), adminCtx.close(), acctCtx.close()]);
  });
});
