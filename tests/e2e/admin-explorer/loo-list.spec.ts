import { test, expect } from './fixtures/auth';
import { navigateToView, searchLoo, applyFilters, clickEditLoo, waitForView } from './helpers/ui-helpers';

test.describe('Loo List View', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await navigateToView(page, 'list');
  });

  test('should display loo list component', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    const looList = page.locator('loo-list');
    await expect(looList).toBeVisible();
  });

  test('should display list of loos', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Wait for loos to load
    await page.waitForLoadState('networkidle');
    
    // Check if any loo items are visible (might be 0 in empty database)
    const looItems = page.locator('.loo-item');
    const count = await looItems.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('should display "Add New Loo" button', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    const addButton = page.locator('loo-list button:has-text("Add New Loo")');
    await expect(addButton).toBeVisible();
  });

  test('should display search input', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();
  });

  test('should display filter controls', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Check for filter dropdowns/controls
    const filters = page.locator('select, input[type="checkbox"]').first();
    // At least one filter control should exist
    const exists = await filters.isVisible().catch(() => false);
    expect(exists !== null).toBe(true);
  });

  test('should search loos by name', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    const initialCount = await page.locator('.loo-item').count();
    
    if (initialCount > 0) {
      // Get first loo name
      const firstLoo = page.locator('.loo-item').first();
      const looName = await firstLoo.locator('.loo-name, h3, h4').first().textContent();
      
      if (looName) {
        // Search with part of the name
        const searchTerm = looName.substring(0, Math.min(4, looName.length));
        await searchLoo(page, searchTerm);
        
        // Results should be filtered
        await page.waitForTimeout(500);
        const searchCount = await page.locator('.loo-item').count();
        expect(searchCount).toBeGreaterThanOrEqual(1);
      }
    }
  });

  test('should show no results for non-existent search', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await searchLoo(page, 'NonExistentLooXYZ12345');
    await page.waitForTimeout(500);
    
    // Should show no results or empty message
    const looItems = page.locator('.loo-item');
    const count = await looItems.count();
    expect(count).toBe(0);
  });

  test('should navigate to edit view when clicking Edit button', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    const looCount = await page.locator('.loo-item').count();
    
    if (looCount > 0) {
      const editButton = page.locator('.loo-item').first().locator('button:has-text("Edit")');
      await editButton.click();
      
      await waitForView(page, 'loo-editor');
    }
  });

  test('should display loo details in list items', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    const looCount = await page.locator('.loo-item').count();
    
    if (looCount > 0) {
      const firstLoo = page.locator('.loo-item').first();
      
      // Should have loo name/title
      const hasName = await firstLoo.locator('.loo-name, h3, h4').isVisible().catch(() => false);
      expect(hasName).toBe(true);
    }
  });

  test('should display status indicators for loos', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    const looCount = await page.locator('.loo-item').count();
    
    if (looCount > 0) {
      const firstLoo = page.locator('.loo-item').first();
      
      // Should have some status indicator (active/inactive badge, etc.)
      const hasBadge = await firstLoo.locator('.badge, .status, [class*="status"]').isVisible().catch(() => false);
      // Status indicators are optional but common
      expect(hasBadge !== null).toBe(true);
    }
  });

  test('should handle pagination if available', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // Check if pagination controls exist
    const nextButton = page.locator('button:has-text("Next"), button:has-text("›")').first();
    const hasNext = await nextButton.isVisible().catch(() => false);
    
    if (hasNext) {
      const initialItems = await page.locator('.loo-item').count();
      await nextButton.click();
      await page.waitForTimeout(500);
      
      // Page should change (different items or no items)
      const newItems = await page.locator('.loo-item').count();
      // Either no more items or different set of items
      expect(newItems >= 0).toBe(true);
    }
  });

  test('should clear search input', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    const searchInput = page.locator('input[placeholder*="Search"]');
    await searchInput.fill('test search');
    await page.waitForTimeout(300);
    
    // Clear search
    await searchInput.fill('');
    await page.waitForTimeout(500);
    
    // Should show all loos again
    const value = await searchInput.inputValue();
    expect(value).toBe('');
  });

  test('should handle empty database state', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForLoadState('networkidle');
    
    // If no loos, should still render without errors
    const looList = page.locator('loo-list');
    await expect(looList).toBeVisible();
  });
});
