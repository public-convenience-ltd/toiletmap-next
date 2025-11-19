import { test, expect } from './fixtures/auth';
import { isAuthenticated } from './helpers/ui-helpers';

test.describe('Authentication', () => {
  test('should successfully authenticate with valid credentials', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Verify we're on the admin page
    await expect(page).toHaveURL(/\/admin/);
    
    // Verify admin app is visible
    const adminApp = page.locator('admin-app');
    await expect(adminApp).toBeVisible();
    
    // Verify sidebar is visible (indicates successful auth)
    const sidebar = page.locator('admin-sidebar');
    await expect(sidebar).toBeVisible();
    
    // Verify not showing access denied
    const accessDenied = page.locator('text=Access Denied');
    await expect(accessDenied).not.toBeVisible();
  });

  test('should persist authentication across page reloads', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Verify initial auth
    expect(await isAuthenticated(page)).toBe(true);
    
    // Reload the page
    await page.reload();
    await page.waitForLoadState('networkidle');
    
    // Verify still authenticated after reload
    expect(await isAuthenticated(page)).toBe(true);
    const sidebar = page.locator('admin-sidebar');
    await expect(sidebar).toBeVisible();
  });

  test('should have access token in localStorage', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Check localStorage for auth token
    const authToken = await page.evaluate(() => {
      const stored = localStorage.getItem('auth_token');
      return stored ? JSON.parse(stored) : null;
    });
    
    expect(authToken).not.toBeNull();
    expect(authToken).toHaveProperty('accessToken');
    expect(authToken).toHaveProperty('expiresAt');
    expect(typeof authToken.accessToken).toBe('string');
    expect(typeof authToken.expiresAt).toBe('number');
    expect(authToken.expiresAt).toBeGreaterThan(Date.now());
  });

  test('should have admin permissions in token', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Decode and check JWT permissions
    const permissions = await page.evaluate(() => {
      const stored = localStorage.getItem('auth_token');
      if (!stored) return null;
      
      const { accessToken } = JSON.parse(stored);
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      return payload.permissions || [];
    });
    
    expect(permissions).toContain('access:admin');
  });

  test('should navigate to different views while authenticated', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Verify can access different views
    const views = [
      { button: 'Map View', component: 'loo-map' },
      { button: 'Statistics', component: 'admin-stats' },
      { button: 'Suspicious Activity', component: 'suspicious-activity' },
      { button: 'Contributors', component: 'contributor-stats' },
      { button: 'Loo List', component: 'loo-list' },
    ];
    
    for (const view of views) {
      await page.click(`button:has-text("${view.button}")`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(view.component)).toBeVisible({ timeout: 5000 });
    }
  });
});
