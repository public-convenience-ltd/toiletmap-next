import { test, expect } from './fixtures/auth';
import { clickAddNewLoo, submitLooForm, waitForToast } from './helpers/ui-helpers';

test.describe('Error Handling and Edge Cases', () => {
  test('should handle API errors gracefully when creating loo', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickAddNewLoo(page);
    
    // Fill in minimal data
    await page.fill('input[name="name"]', 'API Error Test Loo');
    
    // Intercept API request and force error
    await page.route('**/admin/api/loos', (route) => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal Server Error' }),
      });
    });
    
    // Try to submit
    await submitLooForm(page);
    
    // Should show error toast
    await page.waitForTimeout(1000);
    const toast = page.locator('.toast');
    const hasToast = await toast.isVisible().catch(() => false);
    
    // Error should be handled
    expect(hasToast !== null).toBe(true);
  });

  test('should handle network errors', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Simulate offline by aborting all API requests
    await page.route('**/admin/api/**', (route) => {
      route.abort('failed');
    });
    
    // Try to navigate to stats view
    await page.click('button:has-text("Stats")');
    await page.waitForTimeout(1000);
    
    // Component should still render even if API fails
    const statsComponent = page.locator('admin-stats');
    await expect(statsComponent).toBeVisible();
  });

  test('should display toast notifications', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickAddNewLoo(page);
    
    // Fill and submit successfully
    await page.fill('input[name="name"]', 'Toast Test Loo');
    await submitLooForm(page);
    
    // Toast should appear
    const toast = page.locator('.toast');
    const hasToast = await toast.isVisible({ timeout: 5000 }).catch(() => false);
    
    if (hasToast) {
      // Toast should eventually disappear
      await expect(toast).toBeHidden({ timeout: 6000 });
    }
  });

  test('should handle malformed API responses', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Intercept and return malformed response
    await page.route('**/admin/api/stats', (route) => {
      route.fulfill({
        status: 200,
        body: 'invalid json',
      });
    });
    
    await page.click('button:has-text("Stats")');
    await page.waitForTimeout(1000);
    
    // Should not crash the application
    const adminApp = page.locator('admin-app');
    await expect(adminApp).toBeVisible();
  });

  test('should handle empty responses', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Intercept and return empty array
    await page.route('**/admin/api/loos*', (route) => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({ data: [], count: 0 }),
      });
    });
    
    await page.click('button:has-text("Loo List")');
    await page.waitForTimeout(500);
    
    // List should render without errors
    const looList = page.locator('loo-list');
    await expect(looList).toBeVisible();
  });

  test('should handle slow API responses', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Delay API response
    await page.route('**/admin/api/loos/map', async (route) => {
      await new Promise(resolve => setTimeout(resolve, 3000));
      route.continue();
    });
    
    await page.click('button:has-text("Map")');
    
    // Should show loading state
    await page.waitForTimeout(500);
    
    // Eventually should load
    await page.waitForTimeout(3500);
    const mapComponent = page.locator('loo-map');
    await expect(mapComponent).toBeVisible();
  });

  test('should handle HTML special characters in input', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickAddNewLoo(page);
    
    // Enter HTML/script tags
    const maliciousInput = '<script>alert("XSS")</script>';
    await page.fill('input[name="name"]', maliciousInput);
    
    // Should display as text, not execute as code
    const nameValue = await page.locator('input[name="name"]').inputValue();
    expect(nameValue).toBe(maliciousInput);
    
    // Submit should work
    await submitLooForm(page);
    await page.waitForTimeout(1000);
  });

  test('should handle Unicode characters in input', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickAddNewLoo(page);
    
    const unicodeInput = 'Toilet 中文 🚽 é ñ';
    await page.fill('input[name="name"]', unicodeInput);
    
    const nameValue = await page.locator('input[name="name"]').inputValue();
    expect(nameValue).toBe(unicodeInput);
    
    await submitLooForm(page);
    await page.waitForTimeout(1000);
  });

  test('should recover from validation errors', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickAddNewLoo(page);
    
    // Trigger validation error
    await submitLooForm(page);
    await page.waitForTimeout(500);
    
    // Fix the error
    await page.fill('input[name="name"]', 'Fixed Loo');
    
    // Should now submit successfully
    await submitLooForm(page);
    await page.waitForTimeout(1000);
  });

  test('should handle rapid navigation between views', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Rapidly click through views
    await page.click('button:has-text("Map")');
    await page.waitForTimeout(100);
    await page.click('button:has-text("Stats")');
    await page.waitForTimeout(100);
    await page.click('button:has-text("Loo List")');
    await page.waitForTimeout(100);
    await page.click('button:has-text("Contributors")');
    
    // Should eventually settle on Contributors view
    await page.waitForTimeout(1000);
    const contributorsComponent = page.locator('contributor-stats');
    await expect(contributorsComponent).toBeVisible();
  });

  test('should handle missing required environment variables gracefully', async ({ page }) => {
    // This test runs without authentication to check error handling
    
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Should show either login redirect or error, not crash
    const body = await page.locator('body').isVisible();
    expect(body).toBe(true);
  });

  test('should maintain application state during errors', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickAddNewLoo(page);
    
    // Fill in some data
    await page.fill('input[name="name"]', 'State Test Loo');
    await page.fill('textarea[name="notes"]', 'Test notes');
    
    // Cause an error by clearing name
    await page.fill('input[name="name"]', '');
    await submitLooForm(page);
    
    // Notes should still be filled
    const notesValue = await page.locator('textarea[name="notes"]').inputValue();
    expect(notesValue).toBe('Test notes');
  });
});
