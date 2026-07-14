import { test, expect } from '@playwright/test';

test.describe('Facility Login Flow', () => {
  test('should display login fields and show error on invalid credentials', async ({ page }) => {
    // Navigate to login page
    await page.goto('/login');

    // Make sure we are on login screen
    await expect(page).toHaveTitle(/Waha Health Care/);
    await expect(page.locator('text=تسجيل الدخول')).toBeVisible();

    // Fill invalid credentials
    await page.fill('input[name="username"]', 'invalid_user');
    await page.fill('input[name="password"]', 'wrong_password');

    // Click submit
    await page.click('button[type="submit"]');

    // Wait for the error to appear
    await expect(page.locator('text=اسم المستخدم أو كلمة المرور غير صحيحة')).toBeVisible();
  });
});
