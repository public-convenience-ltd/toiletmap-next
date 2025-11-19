import { test, expect } from '../fixtures/auth';
import { navigateToView, waitForView } from '../helpers/ui-helpers';

test.describe('Navigation and Routing', () => {
  test('should navigate to all main views from sidebar', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Test navigation to each view
    const views = [
      { name: 'Loo List', button: 'Loo List', component: 'loo-list' },
      { name: 'Map', button: 'Map', component: 'loo-map' },
      { name: 'Stats', button: 'Stats', component: 'admin-stats' },
      { name: 'Suspicious Activity', button: 'Suspicious Activity', component: 'suspicious-activity' },
      { name: 'Contributors', button: 'Contributors', component: 'contributor-stats' },
    ];
    
    for (const view of views) {
      await page.click(`button:has-text("${view.button}")`);
      await page.waitForLoadState('networkidle');
      
      const component = page.locator(view.component);
      await expect(component).toBeVisible({ timeout: 10000 });
    }
  });

  test('should navigate back to list from other views', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Go to map view
    await page.click('button:has-text("Map")');
    await waitForView(page, 'loo-map');
    
    // Navigate back to list
    await page.click('button:has-text("Loo List")');
    await waitForView(page, 'loo-list');
  });

  test('should maintain sidebar visibility across navigation', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    const sidebar = page.locator('admin-sidebar');
    
    // Sidebar should be visible on all views
    const views = ['Map', 'Stats', 'Suspicious Activity', 'Contributors', 'Loo List'];
    
    for (const view of views) {
      await page.click(`button:has-text("${view}")`);
      await page.waitForLoadState('networkidle');
      await expect(sidebar).toBeVisible();
    }
  });

  test('should navigate to edit view when clicking Add New Loo', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Click Add New Loo button
    const addButton = page.locator('button:has-text("Add New Loo")');
    await addButton.click();
    await page.waitForLoadState('networkidle');
    
    // Verify we're on the editor
    const editor = page.locator('loo-editor');
    await expect(editor).toBeVisible();
    
    // Verify it's showing "Add New Loo" title
    const title = page.locator('h1:has-text("Add New Loo")');
    await expect(title).toBeVisible();
  });

  test('should navigate back to list from editor', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Navigate to editor
    await page.click('button:has-text("Add New Loo")');
    await waitForView(page, 'loo-editor');
    
    // Click back button
    await page.click('button:has-text("Back")');
    await waitForView(page, 'loo-list');
  });

  test('should handle browser back button', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Navigate through views
    await page.click('button:has-text("Map")');
    await waitForView(page, 'loo-map');
    
    await page.click('button:has-text("Stats")');
    await waitForView(page, 'admin-stats');
    
    // Use browser back button
    await page.goBack();
    await waitForView(page, 'loo-map');
    
    await page.goBack();
    await waitForView(page, 'loo-list');
  });

  test('should handle browser forward button', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Navigate through views
    await page.click('button:has-text("Map")');
    await waitForView(page, 'loo-map');
    
    await page.click('button:has-text("Stats")');
    await waitForView(page, 'admin-stats');
    
    // Go back twice
    await page.goBack();
    await page.goBack();
    
    // Go forward
    await page.goForward();
    await waitForView(page, 'loo-map');
    
    await page.goForward();
    await waitForView(page, 'admin-stats');
  });
});
