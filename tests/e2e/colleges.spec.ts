/**
 * E2E: Sysadmin → Colleges (Round 8, 2026-10-18).
 *
 * Adds a uniquely named test college, renames it, hides and shows it, then deletes it,
 * so it leaves nothing behind on staging.
 */
import { test, expect } from '@playwright/test';
import { loginAs, USERS } from './fixtures';

test('sysadmin can add, rename, hide and delete a college', async ({ page: pg }) => {
  test.setTimeout(240000);
  const name = `E2E College ${Date.now()}`;
  const renamed = `${name} (renamed)`;

  await loginAs(pg, USERS.sysadmin.username, USERS.sysadmin.password);
  await pg.goto('/sysadmin/colleges', { waitUntil: 'domcontentloaded' });
  await expect(pg.getByRole('button', { name: '+ Add College' })).toBeVisible({ timeout: 60000 });

  await pg.getByRole('button', { name: '+ Add College' }).click();
  await pg.getByLabel('College or school name').fill(name);
  await pg.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(pg.getByText(name, { exact: true })).toBeVisible({ timeout: 30000 });

  await pg.getByRole('button', { name: `Rename ${name}`, exact: true }).click();
  await pg.getByLabel('College or school name').fill(renamed);
  await pg.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(pg.getByText(renamed, { exact: true })).toBeVisible({ timeout: 30000 });

  await pg.getByRole('button', { name: `Hide ${renamed}`, exact: true }).click();
  await expect(pg.getByRole('button', { name: `Show ${renamed}`, exact: true })).toBeVisible({ timeout: 30000 });
  await pg.getByRole('button', { name: `Show ${renamed}`, exact: true }).click();
  await expect(pg.getByRole('button', { name: `Hide ${renamed}`, exact: true })).toBeVisible({ timeout: 30000 });

  await pg.getByRole('button', { name: `Delete ${renamed}`, exact: true }).click();
  await pg.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(pg.getByText(renamed, { exact: true })).toHaveCount(0, { timeout: 30000 });
});
