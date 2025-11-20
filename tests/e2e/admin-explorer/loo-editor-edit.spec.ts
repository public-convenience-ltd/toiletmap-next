import { test, expect } from './fixtures/auth';
import {
  navigateToView,
  clickEditLoo,
  submitLooForm,
  setTriState,
  setOpeningHours,
  setMapLocation,
  waitForToast,
  clickBackToList,
  waitForView,
  clickAddNewLoo,
} from './helpers/ui-helpers';
import { generateValidLoo } from './fixtures/test-data';

test.describe('Loo Editor - Edit Existing Loo', () => {
  // Create a fresh test loo before each test to ensure isolated data
  test.beforeEach(async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    // Navigate to list and create a new test loo
    await navigateToView(page, 'list');
    await clickAddNewLoo(page);

    // Create a test loo with known data
    const testLoo = generateValidLoo();
    await page.fill('input[name="name"]', testLoo.name);
    await setMapLocation(page, 51.5074, -0.1278);
    await setTriState(page, 'accessible', 'unknown');
    await setTriState(page, 'babyChange', 'unknown');
    await setTriState(page, 'radar', 'unknown');
    await setOpeningHours(page, 'monday', '10:00', '18:00');

    await submitLooForm(page);
    await waitForToast(page, 'created successfully');
    await waitForView(page, 'loo-list');
  });

  test('should load existing loo data in editor', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Click edit on first loo in list
    await clickEditLoo(page, 0);
    
    // Verify editor is visible
    await waitForView(page, 'loo-editor');
    
    // Verify title shows "Edit Loo"
    const title = page.locator('h1:has-text("Edit Loo")');
    await expect(title).toBeVisible();
    
    // Verify form has data loaded
    const nameInput = page.locator('input[name="name"]');
    const nameValue = await nameInput.inputValue();
    expect(nameValue).not.toBe('');
  });

  test('should pre-populate all fields with existing data', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Verify various fields are populated
    const nameInput = page.locator('input[name="name"]');
    expect(await nameInput.inputValue()).not.toBe('');
    
    // Verify location is populated if exists
    const latInput = page.locator('input[name="lat"]');
    const latValue = await latInput.inputValue();
    if (latValue) {
      expect(parseFloat(latValue)).toBeGreaterThanOrEqual(-90);
      expect(parseFloat(latValue)).toBeLessThanOrEqual(90);
    }
  });

  test('should update loo name successfully', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Get original name
    const nameInput = page.locator('input[name="name"]');
    const originalName = await nameInput.inputValue();
    
    // Update name
    const newName = `${originalName} - Updated ${Date.now()}`;
    await nameInput.fill(newName);
    
    // Submit
    await submitLooForm(page);
    await waitForToast(page, 'updated successfully');
    
    // Verify redirected to list
    await waitForView(page, 'loo-list');
  });

  test('should display changes summary when editing fields', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Make a change to a field
    const nameInput = page.locator('input[name="name"]');
    const originalName = await nameInput.inputValue();
    await nameInput.fill(originalName + ' Modified');
    
    // Wait for changes summary to update
    await page.waitForTimeout(500);
    
    // Verify changes list shows the modification
    const changesList = page.locator('#changes-list');
    await expect(changesList).toContainText('Name');
  });

  test('should show "No changes made" when form is unchanged', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Verify "No changes made" message
    const changesList = page.locator('#changes-list');
    await expect(changesList).toContainText('No changes made');
  });

  test('should update tri-state fields', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');

    // Change baby change field to 'yes' to ensure a change
    await setTriState(page, 'babyChange', 'yes');

    // Verify change appears in summary
    await page.waitForTimeout(500);
    const changesList = page.locator('#changes-list');
    await expect(changesList).toContainText('Baby Change');

    // Submit
    await submitLooForm(page);
    await waitForToast(page, 'updated successfully');
  });

  test('should update location coordinates', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');

    // Change location to a significantly different value
    await setMapLocation(page, 52.5, -1.5);

    // Verify change in summary (wait longer for map move to trigger update)
    await page.waitForTimeout(1000);
    const changesList = page.locator('#changes-list');
    await expect(changesList).toContainText('Location');

    // Submit
    await submitLooForm(page);
    await waitForToast(page, 'updated successfully');
  });

  test('should reset map location to original', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Get original coordinates
    const latInput = page.locator('input[name="lat"]');
    const originalLat = await latInput.inputValue();
    
    // Change location
    await setMapLocation(page, 52.0, -1.0);
    
    // Click reset button
    const resetButton = page.locator('button:has-text("Reset to Original Location")');
    if (await resetButton.isVisible()) {
      await resetButton.click();
      
      // Verify coordinates reset
      await page.waitForTimeout(500);
      const currentLat = await latInput.inputValue();
      expect(parseFloat(currentLat)).toBeCloseTo(parseFloat(originalLat), 4);
      
      await waitForToast(page, 'reset to original');
    }
  });

  test('should update opening hours', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');

    // Update Monday hours to unusual times to ensure change is detected
    await setOpeningHours(page, 'monday', '06:00', '22:00');

    // Verify change in summary
    await page.waitForTimeout(500);
    const changesList = page.locator('#changes-list');
    await expect(changesList).toContainText('Monday Hours');

    // Submit
    await submitLooForm(page);
    await waitForToast(page, 'updated successfully');
  });

  test('should update payment details', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Change to paid
    await setTriState(page, 'noPayment', 'no');
    
    // Fill payment details
    await page.fill('input[name="paymentDetails"]', '50p - updated');
    
    // Submit
    await submitLooForm(page);
    await waitForToast(page, 'updated successfully');
  });

  test('should update notes field', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Update notes
    const notesInput = page.locator('textarea[name="notes"]');
    await notesInput.fill('Updated notes at ' + new Date().toISOString());
    
    // Verify change in summary
    await page.waitForTimeout(500);
    const changesList = page.locator('#changes-list');
    await expect(changesList).toContainText('Notes');
    
    // Submit
    await submitLooForm(page);
    await waitForToast(page, 'updated successfully');
  });

  test('should toggle report history visibility', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Click "Show History" button
    const historyButton = page.locator('button:has-text("History")');
    if (await historyButton.isVisible()) {
      await historyButton.click();
      
      // Verify timeline appears
      await page.waitForTimeout(500);
      const timeline = page.locator('report-timeline');
      await expect(timeline).toBeVisible();
      
      // Click "Hide History"
      await historyButton.click();
      await page.waitForTimeout(500);
      
      // Timeline should be hidden
      await expect(timeline).not.toBeVisible();
    }
  });

  test('should reset form to original values', async ({ authenticatedPage }) => {
    const page = authenticatedPage;

    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');

    // Get original name
    const nameInput = page.locator('input[name="name"]');
    const originalName = await nameInput.inputValue();

    // Make changes
    await nameInput.fill('Changed Name');
    await setTriState(page, 'accessible', 'no');

    // Find and click the form reset button (not the map location reset button)
    const resetButton = page.locator('button:has-text("Reset"):not(:has-text("Location"))');
    if (await resetButton.isVisible()) {
      await resetButton.click();

      // Wait for toast to appear (indicates reset completed)
      await waitForToast(page, 'Form reset');

      // Verify form reset
      const currentName = await nameInput.inputValue();
      expect(currentName).toBe(originalName);
    }
  });

  test('should handle editing loo with null/missing fields', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Verify form handles null values gracefully
    const notesInput = page.locator('textarea[name="notes"]');
    const notesValue = await notesInput.inputValue();
    // Notes can be empty, shouldn't cause errors
    expect(notesValue !== null).toBe(true);
    
    // Try to submit without changes
    await submitLooForm(page);
    await waitForToast(page, 'updated successfully');
  });

  test('should validate required fields when editing', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Clear required name field
    const nameInput = page.locator('input[name="name"]');
    await nameInput.fill('');
    
    // Try to submit
    await submitLooForm(page);
    
    // Should show validation error
    await waitForToast(page, 'validation errors');
  });

  test('should navigate away without saving changes', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Make a change
    const nameInput = page.locator('input[name="name"]');
    await nameInput.fill('Unsaved Change');
    
    // Click back without saving
    await clickBackToList(page);
    
    // Should return to list view (changes discarded)
    await waitForView(page, 'loo-list');
  });

  test('should update multiple fields simultaneously', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Update multiple fields
    const nameInput = page.locator('input[name="name"]');
    const originalName = await nameInput.inputValue();
    await nameInput.fill(originalName + ' - Multi Update');

    // Set fields to ensure changes are detected
    await setTriState(page, 'babyChange', 'yes');
    await setTriState(page, 'radar', 'yes');
    await setOpeningHours(page, 'monday', '08:00', '20:00');

    // Verify all changes in summary
    await page.waitForTimeout(500);
    const changesList = page.locator('#changes-list');
    await expect(changesList).toContainText('Name');
    await expect(changesList).toContainText('Baby Change');
    await expect(changesList).toContainText('Monday Hours');
    
    // Submit
    await submitLooForm(page);
    await waitForToast(page, 'updated successfully');
  });

  test('should handle special characters in updated fields', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await clickEditLoo(page, 0);
    await waitForView(page, 'loo-editor');
    
    // Update with special characters
    const notesInput = page.locator('textarea[name="notes"]');
    await notesInput.fill('Special: é, ñ, 中文, 🚽, <script>alert("test")</script>');
    
    // Submit
    await submitLooForm(page);
    await waitForToast(page, 'updated successfully');
  });
});
