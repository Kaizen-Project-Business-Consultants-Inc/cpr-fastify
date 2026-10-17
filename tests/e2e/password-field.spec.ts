/**
 * E2E: the show/hide (eye) button on password boxes, and the live
 * "Passwords match" hint on the reset page.
 *
 * Read-only: every dialog opened here is cancelled, so nothing is saved.
 */
import { test, expect, Page, BrowserContext } from '@playwright/test';
import { loginAs, USERS } from './fixtures';

/** Click the eye on a password box and check the box switches between hidden and shown. */
async function expectEyeToggles(page: Page, input: ReturnType<Page['locator']>) {
  await expect(input).toHaveAttribute('type', 'password');
  // The eye button sits in the same MUI input wrapper as the field.
  const wrapper = input.locator('xpath=ancestor::div[contains(@class,"MuiInputBase-root")][1]');
  await wrapper.getByRole('button', { name: 'Show password' }).click();
  await expect(input).toHaveAttribute('type', 'text');
  await wrapper.getByRole('button', { name: 'Hide password' }).click();
  await expect(input).toHaveAttribute('type', 'password');
}

test.describe('Password boxes — public pages', () => {
  test('login page: eye shows and hides the password', async ({ page }) => {
    await page.goto('/login');
    const pw = page.locator('input[name="password"]');
    await expect(pw).toBeVisible({ timeout: 45000 });
    await pw.fill('NotARealPassword1');
    await expectEyeToggles(page, pw);
    await expect(pw).toHaveValue('NotARealPassword1');
  });

  test('reset page: live match hint and eye buttons', async ({ page }) => {
    // Any token renders the form; nothing is submitted.
    await page.goto('/reset-password?token=e2e-not-a-real-token');
    const pw = page.locator('input[name="password"]');
    const confirm = page.locator('input[name="confirmPassword"]');
    await expect(pw).toBeVisible({ timeout: 45000 });

    await pw.fill('Short1');
    await expect(page.getByText('Must be at least 8 characters', { exact: true })).toBeVisible();

    await pw.fill('Testing123');
    await confirm.fill('Testing12');
    await expect(page.getByText('Passwords do not match')).toBeVisible();
    await expect(confirm).toHaveAttribute('aria-invalid', 'true');
    await expect(pw).toHaveAttribute('aria-invalid', 'false');

    await confirm.fill('Testing123');
    await expect(page.getByText('Passwords match', { exact: true })).toBeVisible();
    await expect(page.getByText('Passwords do not match')).toHaveCount(0);

    await expectEyeToggles(page, pw);
    await expectEyeToggles(page, confirm);
  });
});

test.describe.serial('Password boxes — sysadmin New User form', () => {
  let ctx: BrowserContext;
  let pg: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    pg = await ctx.newPage();
    await loginAs(pg, USERS.sysadmin.username, USERS.sysadmin.password);
  });
  test.afterAll(() => ctx.close());

  test('eye shows and hides the password', async () => {
    await pg.getByText('User Management').click();
    await pg.getByRole('button', { name: '+ New User' }).click();
    const dialog = pg.getByRole('dialog');
    await expect(dialog.getByText('Add New User')).toBeVisible({ timeout: 30000 });
    const pw = dialog.locator('input[name="password"]');
    await pw.fill('Testing123');
    await expectEyeToggles(pg, pw);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe.serial('Password boxes — Course Admin Add Instructor form', () => {
  let ctx: BrowserContext;
  let pg: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180000);
    ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    pg = await ctx.newPage();
    await loginAs(pg, USERS.courseadmin.username, USERS.courseadmin.password);
  });
  test.afterAll(() => ctx.close());

  test('eye shows and hides the password', async () => {
    await pg.goto('/admin/instructors', { waitUntil: 'domcontentloaded' });
    await pg.getByRole('button', { name: 'Add Instructor' }).first().click({ timeout: 30000 });
    const dialog = pg.getByRole('dialog');
    await expect(dialog.getByText('Add Instructor').first()).toBeVisible({ timeout: 30000 });
    const pw = dialog.locator('input[name="password"]');
    await pw.fill('Testing123');
    await expectEyeToggles(pg, pw);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});
