/**
 * E2E: real cross-role business workflows, not just navigation.
 *
 * Unlike navigation.spec.ts / portal.spec.ts (which only click around and
 * check screens render), these tests actually submit the real forms a
 * customer would: creating availability, requesting a course, assigning an
 * instructor, uploading a vendor invoice, approving it, and paying it. Every
 * record created here carries TEST_MARKER so it's obvious in the staging
 * data that it's safe to ignore or delete.
 *
 * These are slower and touch more of the app than the other suites, so they
 * are meant to be run on request, not on every push.
 */
import { test, expect } from '@playwright/test';
import { loginAs, USERS, TEST_MARKER, farFutureDate, getAccessToken, minimalPdfBuffer } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';

test.describe.serial('Workflow: availability -> course request -> instructor assignment', () => {
  // Once an instructor is assigned to a course on a given date, they no
  // longer show up as "available" for a second course on that same date —
  // correct real behaviour, but it means re-running this suite on the same
  // calendar day needs a fresh date each time, not just a fresh location, or
  // the second run finds zero available instructors. Spread across ~10 days
  // (still well past the 11-day lock window) so same-day reruns don't collide.
  const runId = Date.now();
  const date = farFutureDate(45 + (runId % 10));
  const location = `${TEST_MARKER} (run ${runId})`;
  const notes = `${TEST_MARKER} (run ${runId})`;

  test('instructor marks a future date available', async ({ browser }) => {
    test.setTimeout(240000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.instructor.username, USERS.instructor.password);

    // The availability screen is a bare MUI calendar grid with no accessible
    // per-day labels, so two independently-driven calendars (this one and the
    // organization's date-picker below) can't reliably be made to land on the
    // exact same day. We call the same endpoint the "Add Availability" button
    // calls, while genuinely logged in through the real login form.
    const token = await getAccessToken(pg);
    const res = await pg.request.post('/api/v1/instructor/availability', {
      headers: { Authorization: `Bearer ${token}` },
      data: { date: date.iso },
    });
    // farFutureDate() is a fixed offset from today, so re-running this suite
    // on the same calendar day (e.g. CI right after a local run) legitimately
    // hits the same date twice. The end state we need — this instructor
    // available on this date — already holds, so that's a pass, not a failure.
    const alreadySet = res.status() === 400 && (await res.text()).includes('already exists');
    expect(
      res.ok() || alreadySet,
      `POST /instructor/availability -> ${res.status()}: ${await res.text().catch(() => '')}`
    ).toBeTruthy();

    await ctx.close();
  });

  test('organization requests a course for that date', async ({ browser }) => {
    test.setTimeout(240000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.orguser.username, USERS.orguser.password);

    await pg.goto('/organization/dashboard');
    await pg.waitForLoadState('domcontentloaded');
    const requestLink = pg.getByText(/request.*course|schedule.*course/i).first();
    await expect(requestLink).toBeVisible({ timeout: 30000 });
    await requestLink.click();
    await pg.waitForLoadState('domcontentloaded');

    const dateField = pg.getByLabel('Scheduled Course Date');
    await expect(dateField).toBeVisible({ timeout: 30000 });
    await dateField.fill(date.us);
    await pg.keyboard.press('Escape');

    const courseTypeSelect = pg.getByLabel('Course Name');
    await courseTypeSelect.click();
    const firstOption = pg.getByRole('option').first();
    await expect(firstOption).toBeVisible({ timeout: 15000 });
    await firstOption.click();

    await pg.getByLabel('Location (Address/Room)').fill(location);
    await pg.getByLabel('# Students Registered').fill('4');
    await pg.getByLabel('Notes / Special Instructions (Optional)').fill(notes);

    const [response] = await Promise.all([
      pg.waitForResponse(
        (r) => r.url().includes('/organization/course-request') && r.request().method() === 'POST',
        { timeout: 20000 }
      ),
      pg.getByRole('button', { name: 'Request Course Schedule' }).click(),
    ]);
    expect(response.ok(), `POST /organization/course-request -> ${response.status()}`).toBeTruthy();

    await ctx.close();
  });

  test('admin assigns the available instructor and confirms the course', async ({ browser }) => {
    test.setTimeout(240000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.admin.username, USERS.admin.password);

    await pg.goto('/admin/dashboard');
    await pg.waitForLoadState('domcontentloaded');
    const navItem = pg.getByText('Instructor Management').first();
    await expect(navItem).toBeVisible({ timeout: 30000 });
    await navItem.click();
    await pg.waitForLoadState('domcontentloaded');

    // Find the pending-course row carrying our marker in its notes, then its
    // "Assign Instructor" action, without assuming a specific row/table tag.
    const noteText = pg.getByText(notes, { exact: false }).first();
    await expect(noteText, 'pending course request with our test marker should be visible').toBeVisible({
      timeout: 30000,
    });
    const row = noteText.locator(
      'xpath=ancestor::*[.//button[normalize-space(text())="Assign Instructor"]][1]'
    );
    await row.getByRole('button', { name: 'Assign Instructor' }).click();

    const dialog = pg.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });

    const instructorsHelp = dialog.getByText(/instructor\(s\) available/i);
    await expect(instructorsHelp).toBeVisible({ timeout: 15000 });
    await expect(instructorsHelp, 'the instructor marked available for this date should show up').not.toContainText(
      '0 instructor(s) available'
    );

    await dialog.getByLabel('Available Instructors').click();
    const listbox = pg.getByRole('listbox');
    await expect(listbox, 'the instructor dropdown should open').toBeVisible({ timeout: 10000 });
    // The dropdown's first option is always the "Select an instructor"
    // placeholder (value=""); the real instructor(s) come after it.
    await listbox.getByRole('option').last().click();
    await dialog.getByLabel('Start Time').fill('09:00');
    await dialog.getByLabel('End Time').fill('13:00');

    const [response] = await Promise.all([
      pg.waitForResponse(
        (r) => r.url().includes('/assign-instructor') && r.request().method() === 'PUT',
        { timeout: 20000 }
      ),
      dialog.getByRole('button', { name: 'Assign Instructor & Confirm Course' }).click(),
    ]);
    expect(response.ok(), `PUT .../assign-instructor -> ${response.status()}`).toBeTruthy();

    await ctx.close();
  });
});

test.describe.serial('Workflow: vendor invoice submit -> approve -> pay', () => {
  const invoiceNumber = `E2E-${Date.now()}`;

  test('vendor uploads an invoice', async ({ browser }) => {
    test.setTimeout(240000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.vendor.username, USERS.vendor.password);

    await pg.goto('/vendor/upload');
    await pg.waitForLoadState('domcontentloaded');

    const vendorSelect = pg.getByLabel('Vendor Name');
    await expect(vendorSelect).toBeVisible({ timeout: 30000 });
    await vendorSelect.click();
    const firstVendor = pg.getByRole('option').first();
    await expect(firstVendor).toBeVisible({ timeout: 15000 });
    await firstVendor.click();

    await pg.getByLabel('Invoice #').fill(invoiceNumber);
    await pg.getByLabel('Quantity').fill('1');
    await pg.getByLabel('Item').fill('Test item');
    await pg.getByLabel('Description').fill(notesFor(invoiceNumber));
    // Money fields all use required=true on "Total" only, which makes MUI
    // append a literal " *" to its accessible name — and getByLabel's
    // substring matching otherwise conflates "Subtotal"/"Total". The `name`
    // attribute on each <TextField> is unambiguous, so use that directly.
    await pg.locator('input[name="rate"]').fill('10.00');
    await pg.locator('input[name="subtotal"]').fill('10.00');
    await pg.locator('input[name="total"]').fill('10.00');

    await pg.setInputFiles('input[aria-label="Invoice file"]', {
      name: 'e2e-test-invoice.pdf',
      mimeType: 'application/pdf',
      buffer: minimalPdfBuffer(),
    });

    // The sidebar nav item is also named "Upload Invoice" — scope to the
    // form's own submit button to avoid matching both.
    await pg.locator('#main-content').getByRole('button', { name: 'Upload Invoice' }).click();
    const confirmDialog = pg.getByRole('dialog').filter({ hasText: 'Submit this invoice?' });
    await expect(confirmDialog).toBeVisible({ timeout: 15000 });

    const [response] = await Promise.all([
      pg.waitForResponse((r) => r.url().includes('/vendor/invoices') && r.request().method() === 'POST', {
        timeout: 20000,
      }),
      confirmDialog.getByRole('button', { name: 'Upload invoice' }).click(),
    ]);
    expect(response.ok(), `POST /vendor/invoices -> ${response.status()}`).toBeTruthy();

    await ctx.close();
  });

  test('vendor submits the invoice to admin', async ({ browser }) => {
    test.setTimeout(240000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.vendor.username, USERS.vendor.password);

    await pg.goto('/vendor/history');
    await pg.waitForLoadState('domcontentloaded');
    // The default "Non-Paid" tab only shows its own already-loaded page,
    // which may not include our brand-new invoice on a staging DB with a lot
    // of history. Our invoice is freshly uploaded, so it's definitely on the
    // "Pending" tab.
    await pg.getByRole('tab', { name: /^Pending/ }).click();
    await expect(
      pg.getByText(invoiceNumber, { exact: false }).first(),
      'the just-uploaded invoice should be listed on the Pending tab'
    ).toBeVisible({ timeout: 30000 });
    await pg.getByRole('button', { name: `View invoice ${invoiceNumber}` }).click();

    const dialog = pg.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Submit to Admin' }).click();

    const confirmDialog = pg.getByRole('dialog').filter({ hasText: 'sent to admin for review' });
    await expect(confirmDialog).toBeVisible({ timeout: 15000 });
    const [response] = await Promise.all([
      pg.waitForResponse(
        (r) => r.url().includes('/submit-to-admin') && r.request().method() === 'POST',
        { timeout: 20000 }
      ),
      confirmDialog.getByRole('button', { name: 'Submit to Admin' }).click(),
    ]);
    expect(response.ok(), `POST .../submit-to-admin -> ${response.status()}`).toBeTruthy();

    await ctx.close();
  });

  test('admin forwards the invoice to accounting', async ({ browser }) => {
    test.setTimeout(240000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.admin.username, USERS.admin.password);

    await pg.goto('/admin/vendor-invoices');
    await pg.waitForLoadState('domcontentloaded');
    await expect(
      pg.getByText(invoiceNumber, { exact: false }).first(),
      'the submitted vendor invoice should be visible to admin'
    ).toBeVisible({ timeout: 30000 });
    await pg.getByRole('button', { name: `View invoice ${invoiceNumber}` }).click();

    const dialog = pg.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });
    const approveBtn = dialog.getByRole('button', { name: 'Submit to Accounting' });
    await expect(approveBtn).toBeVisible({ timeout: 15000 });

    const [response] = await Promise.all([
      pg.waitForResponse((r) => r.url().includes('/approve') && r.request().method() === 'POST', {
        timeout: 20000,
      }),
      approveBtn.click(),
    ]);
    expect(response.ok(), `POST .../approve -> ${response.status()}`).toBeTruthy();

    await ctx.close();
  });

  test('accountant records payment on the vendor invoice', async ({ browser }) => {
    test.setTimeout(240000);
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const pg = await ctx.newPage();
    await loginAs(pg, USERS.accountant.username, USERS.accountant.password);

    await pg.goto('/accounting/vendor-invoices');
    await pg.waitForLoadState('domcontentloaded');
    await expect(
      pg.getByText(invoiceNumber, { exact: false }).first(),
      'the approved vendor invoice should be visible to accounting'
    ).toBeVisible({ timeout: 30000 });
    await pg.getByRole('button', { name: `View invoice ${invoiceNumber}` }).click();

    const dialog = pg.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });

    await dialog.getByLabel('Payment Amount').fill('10.00');
    const referenceField = dialog.getByLabel('Reference Number');
    await referenceField.fill('E2E-TEST');
    await dialog.getByLabel('Payment Notes').fill(notesFor(invoiceNumber));

    await dialog.getByRole('button', { name: 'Process Payment' }).click();
    const confirmDialog = pg.getByRole('dialog').filter({ hasText: 'Process this payment?' });
    await expect(confirmDialog).toBeVisible({ timeout: 15000 });

    const [response] = await Promise.all([
      pg.waitForResponse((r) => r.url().includes('/payments') && r.request().method() === 'POST', {
        timeout: 20000,
      }),
      confirmDialog.getByRole('button', { name: 'Process Payment' }).click(),
    ]);
    expect(response.ok(), `POST .../payments -> ${response.status()}`).toBeTruthy();

    await ctx.close();
  });
});

function notesFor(invoiceNumber: string): string {
  return `${TEST_MARKER} — invoice ${invoiceNumber}`;
}
