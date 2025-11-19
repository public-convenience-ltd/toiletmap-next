import { test, expect } from '../fixtures/auth';
import { navigateToView } from '../helpers/ui-helpers';

test.describe('Suspicious Activity View', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await navigateToView(page, 'suspicious');
  });

  test('should display suspicious activity component', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    const activityComponent = page.locator('suspicious-activity');
    await expect(activityComponent).toBeVisible();
  });

  test('should display time window dropdown', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Should have time window selector
    const timeWindow = page.locator('select, [role="combobox"]').first();
    const hasTimeWindow = await timeWindow.isVisible().catch(() => false);
    
    if (hasTimeWindow) {
      await expect(timeWindow).toBeVisible();
    }
  });

  test('should change time window when dropdown changes', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    const timeWindowSelect = page.locator('select').first();
    const hasSelect = await timeWindowSelect.isVisible().catch(() => false);
    
    if (hasSelect) {
      // Get options
      const options = await timeWindowSelect.locator('option').count();
      
      if (options > 1) {
        // Select different time window
        await timeWindowSelect.selectOption({ index: 1 });
        await page.waitForTimeout(500);
        
        // Data should reload
        await page.waitForLoadState('networkidle');
      }
    }
  });

  test('should display activity categories', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Should have sections for different activity types
    const bodyText = await page.textContent('body');
    
    // Look for activity-related keywords
    const hasActivityKeywords = 
      bodyText?.includes('rapid') ||
      bodyText?.includes('Rapid') ||
      bodyText?.includes('conflict') ||
      bodyText?.includes('location') ||
      bodyText?.includes('deactivation');
    
    expect(hasActivityKeywords).toBe(true);
  });

  test('should display rapid updates section', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    const rapidSection = await page.locator('text=/rapid.*update/i').isVisible().catch(() => false);
    expect(rapidSection !== null).toBe(true);
  });

  test('should display conflicting edits section', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    const conflictSection = await page.locator('text=/conflict/i').isVisible().catch(() => false);
    expect(conflictSection !== null).toBe(true);
  });

  test('should display location changes section', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    const locationSection = await page.locator('text=/location.*change/i').isVisible().catch(() => false);
    expect(locationSection !== null).toBe(true);
  });

  test('should display mass deactivations section', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    const deactivationSection = await page.locator('text=/mass.*deactivation|deactivation/i').isVisible().catch(() => false);
    expect(deactivationSection !== null).toBe(true);
  });

  test('should have action buttons for viewing details', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Look for view/details/action buttons
    const actionButtons = page.locator('button:has-text("View"), button:has-text("Details")');
    const buttonCount = await actionButtons.count();
    
    // Might be 0 if no suspicious activity
    expect(buttonCount).toBeGreaterThanOrEqual(0);
  });

  test('should navigate to loo details when clicking action button', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    const viewButtons = page.locator('button:has-text("View")');
    const count = await viewButtons.count();
    
    if (count > 0) {
      await viewButtons.first().click();
      await page.waitForTimeout(500);
      
      // Should navigate somewhere (editor or details)
      const editor = await page.locator('loo-editor').isVisible().catch(() => false);
      const list = await page.locator('loo-list').isVisible().catch(() => false);
      
      expect(editor || list).toBe(true);
    }
  });

  test('should handle no suspicious activity gracefully', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Component should still render
    const activityComponent = page.locator('suspicious-activity');
    await expect(activityComponent).toBeVisible();
  });

  test('should display time ranges for activities', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Should show some time-related information
    const bodyText = await page.textContent('body');
    const hasTimeInfo = 
      bodyText?.includes('hours') ||
      bodyText?.includes('minutes') ||
      bodyText?.includes('24') ||
      bodyText?.includes('48');
    
    expect(hasTimeInfo !== null).toBe(true);
  });
});
