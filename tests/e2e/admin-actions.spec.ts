/**
 * E2E: buttons added for server features that had no screen (Round 6, 2026-10-17).
 *
 * Read-only: confirmation dialogs are opened and cancelled, so no reset email is sent and
 * no data is erased, rejected or removed. CSV exports only download.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { loginAs, USERS } from './fixtures';

async function expectCsvDownload(pg: Page, click: () => Promise<void>, namePattern: RegExp) {
  const [download] = await Promise.all([pg.waitForEvent('download', { timeout: 60000 }), click()]);
  expect(download.suggestedFilename()).toMatch(namePattern);
}

test.describe.serial('sysadmin: user actions and exports', () => {
  let ctx: BrowserContext;
  let pg: Page;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    ctx = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
    pg = await ctx.newPage();
    await loginAs(pg, USERS.sysadmin.username, USERS.sysadmin.password);
  });
  test.afterAll(() => ctx.close());
  test.beforeEach(() => test.setTimeout(150000));

  test('a user row offers a reset link and a guarded erase', async () => {
    await pg.goto('/sysadmin/users', { waitUntil: 'domcontentloaded' });
    await pg.getByPlaceholder(/search/i).first().fill(USERS.instructor.username);
    const more = pg.getByRole('button', { name: `More actions for ${USERS.instructor.username}`, exact: true });
    await expect(more).toBeVisible({ timeout: 60000 });

    await more.click();
    await pg.getByRole('menuitem', { name: 'Send password reset link' }).click();
    await expect(pg.getByText('Send a password reset link?')).toBeVisible();
    await pg.getByRole('button', { name: 'Cancel' }).click();

    await more.click();
    await pg.getByRole('menuitem', { name: /Erase personal data/ }).click();
    const dialog = pg.getByRole('dialog', { name: 'Erase personal data?' });
    await expect(dialog).toBeVisible();
    const erase = dialog.getByRole('button', { name: 'Erase personal data' });
    await expect(erase).toBeDisabled();
    await dialog.getByLabel(/Type .* to confirm/).fill('not-the-username');
    await expect(erase).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('students and WSIB history download as CSV', async () => {
    await pg.goto('/sysadmin/students', { waitUntil: 'domcontentloaded' });
    const studentsExport = pg.getByRole('button', { name: 'Export CSV' });
    await expect(studentsExport).toBeVisible({ timeout: 60000 });
    await expectCsvDownload(pg, () => studentsExport.click(), /^students-\d{4}-\d{2}-\d{2}\.csv$/);

    await pg.goto('/sysadmin/wsib-reporting', { waitUntil: 'domcontentloaded' });
    const wsibExport = pg.getByRole('button', { name: 'Export CSV' });
    await expect(wsibExport).toBeVisible({ timeout: 60000 });
    await expectCsvDownload(pg, () => wsibExport.click(), /^wsib-compliance-.*\.csv$/);
  });
});

test.describe.serial('accountant: invoice export', () => {
  let ctx: BrowserContext;
  let pg: Page;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    ctx = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true });
    pg = await ctx.newPage();
    await loginAs(pg, USERS.accountant.username, USERS.accountant.password);
  });
  test.afterAll(() => ctx.close());

  test('Invoice History downloads every invoice as CSV', async () => {
    test.setTimeout(150000);
    await pg.goto('/accounting/history', { waitUntil: 'domcontentloaded' });
    const exportButton = pg.getByRole('button', { name: 'Export CSV' });
    await expect(exportButton).toBeVisible({ timeout: 60000 });
    await expectCsvDownload(pg, () => exportButton.click(), /^invoices-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
