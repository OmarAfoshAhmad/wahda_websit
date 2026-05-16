import { test, expect } from '@playwright/test';
import path from 'path';

test.describe('Beneficiary Migration Flow', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"]', 'admin');
    await page.fill('input[name="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/.*dashboard|beneficiaries/);
  });

  test('should display card numbering page with UI elements', async ({ page }) => {
    await page.goto('/admin/card-numbering');
    await expect(page.locator('h1')).toContainText('ترقيم البطاقات');

    // تحقق من وجود أزرار التحكم الأساسية
    await expect(page.locator('text=استيراد وتدقيق')).toBeVisible();
    await expect(page.locator('text=ترحيل')).toBeVisible();
    await expect(page.locator('text=سلة المحذوفات')).toBeVisible();

    // تحقق من وجود الفلاتر
    await expect(page.locator('text=الكل')).toBeVisible();
    await expect(page.locator('text=جاهز (')).toBeVisible();

    // تحقق من وجود حقل البحث
    await expect(page.locator('input[placeholder*="بحث"]')).toBeVisible();
  });

  test('should handle empty archive state', async ({ page }) => {
    await page.goto('/admin/card-numbering');

    if (await page.locator('text=لا توجد بيانات بانتظار المعالجة').isVisible()) {
      await expect(page.locator('text=لا توجد بيانات بانتظار المعالجة')).toBeVisible();
    } else {
      await expect(page.locator('table')).toBeVisible();
    }
  });

  test('should navigate rollback tab when logs exist', async ({ page }) => {
    await page.goto('/admin/card-numbering');

    // تحقق من وجود تبويب السجل
    const historyButton = page.locator('button:has-text("سجل الترحيل")');
    if (await historyButton.isVisible()) {
      await historyButton.click();
      await expect(page.locator('text=سجل الترحيل')).toBeVisible();
    }
  });
});
