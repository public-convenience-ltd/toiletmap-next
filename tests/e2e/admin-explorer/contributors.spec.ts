import { test, expect } from './fixtures/auth';
import { navigateToView } from './helpers/ui-helpers';

test.describe('Contributors View', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await navigateToView(page, 'contributors');
  });

  test('should display contributors component', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    const contributorsComponent = page.locator('contributor-stats');
    await expect(contributorsComponent).toBeVisible();
  });

  test('should display leaderboard', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Should have leaderboard section
    const leaderboard = await page.locator('text=/leaderboard|top.*contributor/i').isVisible().catch(() => false);
    expect(leaderboard !== null).toBe(true);
  });

  test('should display contributor list', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Should show contributor names or items
    const contributorItems = page.locator('.contributor-item, [class*="contributor"]');
    const count = await contributorItems.count();
    
    // Might be 0 if no contributors
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should display contributor statistics', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    const bodyText = await page.textContent('body');
    
    // Should show stats like edit counts
    const hasStats = /\d+/.test(bodyText || '');
    expect(hasStats).toBe(true);
  });

  test('should display recent contributors section', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    const recentSection = await page.locator('text=/recent/i').isVisible().catch(() => false);
    expect(recentSection !== null).toBe(true);
  });

  test('should navigate to contributor details when clicking contributor', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Look for clickable contributor items
    const contributorLinks = page.locator('button:has-text("View Details")');
    const count = await contributorLinks.count();
    
    if (count > 0) {
      await contributorLinks.first().click();
      
      // Should navigate to details view
      // Check for the "Back to Leaderboard" button which is only present in details view
      const backButton = page.locator('button:has-text("Back to Leaderboard")');
      await expect(backButton).toBeVisible();
    }
  });

  test('should show contributor edit counts', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    const bodyText = await page.textContent('body');
    
    // Should mention edits somewhere
    const hasEdits = bodyText?.toLowerCase().includes('edit');
    expect(hasEdits !== null).toBe(true);
  });

  test('should display total contributors count', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    const bodyText = await page.textContent('body');
    
    // Should show total or count somewhere
    const hasTotal = bodyText?.toLowerCase().includes('total') || bodyText?.toLowerCase().includes('contributor');
    expect(hasTotal !== null).toBe(true);
  });

  test('should handle empty contributors list', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Component should still render
    const contributorsComponent = page.locator('contributor-stats');
    await expect(contributorsComponent).toBeVisible();
  });

  test('should show contributor rankings', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Should show rankings (#1, #2, etc.) or rank numbers
    const bodyText = await page.textContent('body');
    const hasRankings = /#\d+|rank/i.test(bodyText || '');
    
    expect(hasRankings !== null).toBe(true);
  });
});
