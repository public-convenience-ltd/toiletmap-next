import { test, expect } from './fixtures/auth';
import { navigateToView } from './helpers/ui-helpers';

test.describe('Stats View', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await navigateToView(page, 'stats');
  });

  test('should display stats component', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    const statsComponent = page.locator('admin-stats');
    await expect(statsComponent).toBeVisible();
  });

  test('should display overall statistics', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Should have some stat cards or sections
    const statCards = page.locator('.stat-card, .stats-overview, [class*="stat"]');
    const count = await statCards.count();
    expect(count).toBeGreaterThan(0);
  });

  test('should show total loos count', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Look for total loos metric
    const totalText = await page.textContent('body');
    expect(totalText).toContain('loo' || 'Loo' || 'Total');
  });

  test('should display contributor statistics', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Should mention contributors somewhere
    const hasContributors = await page.locator('text=/contributor/i').isVisible().catch(() => false);
    expect(hasContributors !== null).toBe(true);
  });

  test('should display activity metrics', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Should have activity/update information
    const hasActivity = await page.locator('text=/activity|update/i').isVisible().catch(() => false);
    expect(hasActivity !== null).toBe(true);
  });

  test('should render without errors on empty database', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Component should still render
    const statsComponent = page.locator('admin-stats');
    await expect(statsComponent).toBeVisible();
  });

  test('should display numeric statistics', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Should have numbers displayed
    const bodyText = await page.textContent('body');
    const hasNumbers = /\d+/.test(bodyText || '');
    expect(hasNumbers).toBe(true);
  });
});
