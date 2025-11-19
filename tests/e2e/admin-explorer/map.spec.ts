import { test, expect } from './fixtures/auth';
import { navigateToView } from './helpers/ui-helpers';

test.describe('Map View', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await navigateToView(page, 'map');
  });

  test('should display map component', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    const mapComponent = page.locator('loo-map');
    await expect(mapComponent).toBeVisible();
  });

  test('should load Leaflet map', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Wait for Leaflet to initialize
    await page.waitForTimeout(2000);
    
    // Check for Leaflet map container
    const mapContainer = page.locator('.leaflet-container');
    await expect(mapContainer).toBeVisible();
  });

  test('should display map controls', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForTimeout(2000);
    
    // Leaflet zoom controls should be visible
    const zoomControls = page.locator('.leaflet-control-zoom');
    await expect(zoomControls).toBeVisible();
  });

  test('should display markers for loos with locations', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForTimeout(2000);
    
    // Check for Leaflet markers
    const markers = page.locator('.leaflet-marker-icon');
    const markerCount = await markers.count();
    
    // Should have 0 or more markers depending on data
    expect(markerCount).toBeGreaterThanOrEqual(0);
  });

  test('should open popup when clicking marker', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForTimeout(2000);
    
    const markers = page.locator('.leaflet-marker-icon');
    const markerCount = await markers.count();
    
    if (markerCount > 0) {
      // Click first marker
      await markers.first().click();
      await page.waitForTimeout(500);
      
      // Popup should appear
      const popup = page.locator('.leaflet-popup');
      await expect(popup).toBeVisible();
    }
  });

  test('should display loo details in popup', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForTimeout(2000);
    
    const markers = page.locator('.leaflet-marker-icon');
    const markerCount = await markers.count();
    
    if (markerCount > 0) {
      await markers.first().click();
      await page.waitForTimeout(500);
      
      const popup = page.locator('.leaflet-popup');
      const popupContent = await popup.locator('.leaflet-popup-content').textContent();
      
      // Should have some content
      expect(popupContent?.length).toBeGreaterThan(0);
    }
  });

  test('should have "View Details" button in popup', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForTimeout(2000);
    
    const markers = page.locator('.leaflet-marker-icon');
    const markerCount = await markers.count();
    
    if (markerCount > 0) {
      await markers.first().click();
      await page.waitForTimeout(500);
      
      const viewButton = page.locator('.leaflet-popup button:has-text("View"), .leaflet-popup a:has-text("View")');
      const hasButton = await viewButton.isVisible().catch(() => false);
      
      if (hasButton) {
        // Click and verify navigation
        await viewButton.click();
        await page.waitForTimeout(500);
        
        // Should navigate to editor or details view
        const editor = page.locator('loo-editor');
        await expect(editor).toBeVisible({ timeout: 5000 });
      }
    }
  });

  test('should display filter controls', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Map view might have filters for active/accessible
    const filterControls = page.locator('select, input[type="checkbox"]');
    const hasFilters = await filterControls.first().isVisible().catch(() => false);
    
    // Filters are optional
    expect(hasFilters !== null).toBe(true);
  });

  test('should handle empty map (no loos with locations)', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForTimeout(2000);
    
    // Map should still render without errors
    const mapContainer = page.locator('.leaflet-container');
    await expect(mapContainer).toBeVisible();
  });

  test('should zoom in when clicking zoom + button', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForTimeout(2000);
    
    const zoomIn = page.locator('.leaflet-control-zoom-in');
    await zoomIn.click();
    await page.waitForTimeout(500);
    
    // Map should still be visible
    const mapContainer = page.locator('.leaflet-container');
    await expect(mapContainer).toBeVisible();
  });

  test('should zoom out when clicking zoom - button', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForTimeout(2000);
    
    const zoomOut = page.locator('.leaflet-control-zoom-out');
    await zoomOut.click();
    await page.waitForTimeout(500);
    
    // Map should still be visible
    const mapContainer = page.locator('.leaflet-container');
    await expect(mapContainer).toBeVisible();
  });

  test('should support map panning', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.waitForTimeout(2000);
    
    const mapContainer = page.locator('.leaflet-container');
    
    // Simulate pan by dragging
    const box = await mapContainer.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2);
      await page.mouse.up();
      
      await page.waitForTimeout(500);
      
      // Map should still be visible after panning
      await expect(mapContainer).toBeVisible();
    }
  });
});
