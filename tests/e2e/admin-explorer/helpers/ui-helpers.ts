import { Page, expect } from '@playwright/test';

/**
 * Helper functions for interacting with admin-explorer UI
 */

/**
 * Navigate to a specific view in the admin panel
 */
export async function navigateToView(page: Page, view: 'list' | 'map' | 'stats' | 'suspicious' | 'contributors'): Promise<void> {
  const buttonSelectors = {
    list: 'button:has-text("Loo List")',
    map: 'button:has-text("Map View")',
    stats: 'button:has-text("Statistics")',
    suspicious: 'button:has-text("Suspicious Activity")',
    contributors: 'button:has-text("Contributors")',
  };

  await page.click(buttonSelectors[view]);
  await page.waitForLoadState('networkidle');
}

/**
 * Fill in a tri-state field (Yes/No/Unknown)
 */
export async function setTriState(
  page: Page,
  fieldName: string,
  value: 'yes' | 'no' | 'unknown'
): Promise<void> {
  const selector = `input[name="${fieldName}"][value="${value === 'yes' ? 'true' : value === 'no' ? 'false' : 'null'}"]`;
  await page.click(selector);
}

/**
 * Fill in opening hours for a specific day
 */
export async function setOpeningHours(
  page: Page,
  day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
  open: string,
  close: string
): Promise<void> {
  await page.fill(`input[name="openingHours.${day}.open"]`, open);
  await page.fill(`input[name="openingHours.${day}.close"]`, close);
}

/**
 * Mark a day as closed
 */
export async function setDayClosed(
  page: Page,
  day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday',
  closed: boolean
): Promise<void> {
  const checkbox = page.locator(`input[name="openingHours.${day}.closed"]`);
  if (closed) {
    await checkbox.check();
  } else {
    await checkbox.uncheck();
  }
}

/**
 * Set map location by entering coordinates
 */
export async function setMapLocation(page: Page, lat: number, lng: number): Promise<void> {
  // The lat/lng inputs are readonly, so we need to move the map instead
  // Execute JavaScript to pan the Leaflet map and wait for the moveend event
  await page.evaluate(([lat, lng]) => {
    return new Promise<void>((resolve) => {
      const mapContainer = document.querySelector('#location-map-picker') as any;
      if (mapContainer && mapContainer._leaflet_id) {
        // Get the Leaflet map instance
        const map = (window as any).L.Map._instances[mapContainer._leaflet_id];
        if (map) {
          // Listen for moveend event to know when map has finished updating
          map.once('moveend', () => {
            // Give a small delay for coordinate display to update
            setTimeout(() => resolve(), 100);
          });
          map.setView([lat, lng], map.getZoom());
        } else {
          resolve();
        }
      } else {
        resolve();
      }
    });
  }, [lat, lng]);
}

/**
 * Wait for toast notification to appear
 */
export async function waitForToast(page: Page, expectedText?: string): Promise<void> {
  const toast = page.locator('.toast');
  await expect(toast).toBeVisible({ timeout: 5000 });
  
  if (expectedText) {
    await expect(toast).toContainText(expectedText);
  }
  
  // Wait for toast to disappear
  await expect(toast).toBeHidden({ timeout: 5000 });
}

/**
 * Click the "Add New Loo" button
 */
export async function clickAddNewLoo(page: Page): Promise<void> {
  await page.click('button:has-text("Add New Loo")');
  await page.waitForLoadState('networkidle');
}

/**
 * Click the "Back" button in editor
 */
export async function clickBackToList(page: Page): Promise<void> {
  await page.click('button:has-text("Back")');
  await page.waitForLoadState('networkidle');
}

/**
 * Submit the loo editor form
 */
export async function submitLooForm(page: Page): Promise<void> {
  await page.click('button[type="submit"]');
  await page.waitForLoadState('networkidle');
}

/**
 * Search for a loo by name
 */
export async function searchLoo(page: Page, query: string): Promise<void> {
  await page.fill('input[placeholder*="Search"]', query);
  await page.waitForTimeout(500); // Debounce
  await page.waitForLoadState('networkidle');
}

/**
 * Apply filters in loo list view
 */
export async function applyFilters(page: Page, filters: {
  active?: 'true' | 'false' | 'all';
  accessible?: 'true' | 'false' | 'all';
}): Promise<void> {
  if (filters.active) {
    await page.selectOption('select[name="activeFilter"]', filters.active);
  }
  if (filters.accessible) {
    await page.selectOption('select[name="accessibleFilter"]', filters.accessible);
  }
  await page.waitForLoadState('networkidle');
}

/**
 * Get the number of loos displayed in the list
 */
export async function getLooCount(page: Page): Promise<number> {
  const looItems = await page.locator('loo-list .loo-item').count();
  return looItems;
}

/**
 * Click on a loo item in the list to edit it
 */
export async function clickEditLoo(page: Page, index: number = 0): Promise<void> {
  const looItems = page.locator('loo-list .loo-item');
  await looItems.nth(index).locator('button:has-text("Edit")').click();
  await page.waitForLoadState('networkidle');
}

/**
 * Verify form has validation error for a field
 */
export async function expectValidationError(page: Page, fieldName: string): Promise<void> {
  const formGroup = page.locator(`.form-group:has(input[name="${fieldName}"])`);
  await expect(formGroup).toHaveClass(/has-error/);
  await expect(formGroup.locator('.form-error')).toBeVisible();
}

/**
 * Verify no validation errors on form
 */
export async function expectNoValidationErrors(page: Page): Promise<void> {
  const errors = page.locator('.form-error');
  await expect(errors).toHaveCount(0);
}

/**
 * Wait for specific view to be loaded
 */
export async function waitForView(page: Page, view: string): Promise<void> {
  await expect(page.locator(view)).toBeVisible({ timeout: 10000 });
}

/**
 * Check if admin panel is properly authenticated
 */
export async function isAuthenticated(page: Page): Promise<boolean> {
  try {
    const adminApp = page.locator('admin-app');
    await expect(adminApp).toBeVisible({ timeout: 5000 });
    
    // Check we're not on login or access denied screen
    const loginText = page.locator('text=Redirecting to login');
    const accessDenied = page.locator('text=Access Denied');
    
    const hasLogin = await loginText.isVisible().catch(() => false);
    const hasDenied = await accessDenied.isVisible().catch(() => false);
    
    return !hasLogin && !hasDenied;
  } catch {
    return false;
  }
}
