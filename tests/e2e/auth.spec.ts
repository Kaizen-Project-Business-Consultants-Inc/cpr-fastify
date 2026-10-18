/**
 * E2E: Authentication flows (no-login tests only)
 *
 * Only contains tests that do NOT require a valid login:
 *   - Login form rendering
 *   - Invalid credential error display
 *   - Public page accessibility
 *   - Unauthenticated redirect
 */
import { test, expect } from '@playwright/test';

test.describe('Login page — public access', () => {
  test('renders username and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('invalid credentials are rejected by the server', async ({ page }) => {
    await page.goto('/login');
    await page.waitForSelector('input[name="username"]');
    await page.fill('input[name="username"]', 'nobody');
    await page.fill('input[name="password"]', 'wrongpass');
    const [response] = await Promise.all([
      page.waitForResponse(
        resp => resp.url().includes('/auth/login') && resp.request().method() === 'POST',
        { timeout: 10000 }
      ),
      page.click('button[type="submit"]'),
    ]);
    expect(response.status()).toBeGreaterThanOrEqual(400);
    await page.waitForURL(/login/, { timeout: 10000 });
    await expect(page).toHaveURL(/login/);
  });

  test('public pages accessible without login', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('h1, h4').first()).toBeVisible();
    await page.goto('/terms');
    await expect(page.locator('h1, h4').first()).toBeVisible();
  });

  test('legal pages go Back to where the visitor came from', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Privacy Policy' }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('a legal page opened directly goes Back to sign-in', async ({ page }) => {
    await page.goto('/terms');
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('login page offers a course request link and link-preview tags', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('link', { name: 'Request a course' })).toHaveAttribute('href', /^mailto:admin@kpbc\.ca\?subject=Course%20request/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'CPR Training Portal');
  });

  test('unauthenticated access to protected route redirects to /login', async ({ page }) => {
    await page.goto('/instructor/dashboard');
    await page.waitForURL(/login/, { timeout: 10000 });
    await expect(page).toHaveURL(/login/);
  });
});
