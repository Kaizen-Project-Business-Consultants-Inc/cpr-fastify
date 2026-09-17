import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { USERS, loginAs } from './fixtures';

/**
 * Sidebar navigation smoke test.
 *
 * For every role: log in, then click every item in the AdminShell sidebar and
 * assert the content area renders something other than a "not found" message.
 * This is the regression guard for broken relative/absolute nav paths and
 * missing portal routes (see docs/AUDIT_2026-09-17.md, B1/B2).
 */

const NOT_FOUND = /view not found|page not found|not found/i;

const ROLES = Object.keys(USERS) as Array<keyof typeof USERS>;

for (const role of ROLES) {
  test.describe.serial(`${role}: every sidebar item renders`, () => {
    let ctx: BrowserContext;
    let pg: Page;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(180000);
      ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      pg = await ctx.newPage();
      await loginAs(pg, USERS[role].username, USERS[role].password);
    });
    test.afterAll(() => ctx.close());

    test('lands on a page with content after login', async () => {
      const main = pg.locator('#main-content, main, [role="main"]').first();
      await expect(main).toBeVisible({ timeout: 30000 });
      await expect(main).not.toContainText(NOT_FOUND);
      // Content area must not be empty (regression: sysadmin blank dashboard)
      await expect.poll(async () => (await main.innerText()).trim().length, { timeout: 30000 }).toBeGreaterThan(0);
    });

    test('every sidebar item renders content', async () => {
      test.setTimeout(240000);
      const sidebar = pg.locator('nav[aria-label="Sidebar"]');
      await expect(sidebar).toBeVisible({ timeout: 30000 });
      const labels = (await sidebar.locator('button, a, [role="button"]').allInnerTexts())
        .map((t) => t.trim())
        .filter((t) => t && !/logout|sign out/i.test(t));

      expect(labels.length).toBeGreaterThan(0);

      for (const label of labels) {
        const item = sidebar.getByText(label, { exact: true }).first();
        await item.click();
        await pg.waitForLoadState('domcontentloaded');
        const main = pg.locator('#main-content, main, [role="main"]').first();
        await expect(main, `"${label}" should render content`).toBeVisible({ timeout: 30000 });
        await expect(main, `"${label}" rendered a not-found view`).not.toContainText(NOT_FOUND, { timeout: 10000 });
        await expect
          .poll(async () => (await main.innerText()).trim().length, { timeout: 30000, message: `"${label}" content area is empty` })
          .toBeGreaterThan(0);
      }
    });
  });
}
