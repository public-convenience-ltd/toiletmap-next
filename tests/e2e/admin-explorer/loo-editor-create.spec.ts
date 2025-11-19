import { test, expect } from '../fixtures/auth';
import {
  clickAddNewLoo,
  submitLooForm,
  setTriState,
  setOpeningHours,
  setDayClosed,
  setMapLocation,
  waitForToast,
  clickBackToList,
  expectValidationError,
  expectNoValidationErrors,
} from '../helpers/ui-helpers';
import {
  generateValidLoo,
  generateLooWithOpeningHours,
  generateLooWithPayment,
  generateLooWithSpecialChars,
  generateLooAtDateLine,
  generateLooAtNorthPole,
} from '../fixtures/test-data';

test.describe('Loo Editor - Create New Loo', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await clickAddNewLoo(page);
  });

  test('should display create loo form with correct initial state', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Verify form title
    const title = page.locator('h1:has-text("Add New Loo")');
    await expect(title).toBeVisible();
    
    // Verify required fields are present
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('input[name="lat"]')).toBeVisible();
    await expect(page.locator('input[name="lng"]')).toBeVisible();
    
    // Verify map picker is visible
    const mapPicker = page.locator('#location-map-picker');
    await expect(mapPicker).toBeVisible();
    
    // Verify submit button
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should create a new loo with minimal required fields', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    const loo = generateValidLoo();
    
    // Fill in required name
    await page.fill('input[name="name"]', loo.name);
    
    // Submit form
    await submitLooForm(page);
    
    // Verify toast notification
    await waitForToast(page, 'created successfully');
    
    // Verify redirected to list view
    await expect(page.locator('loo-list')).toBeVisible({ timeout: 5000 });
  });

  test('should create a loo with all fields filled', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    const loo = generateValidLoo();
    
    // Fill in basic info
    await page.fill('input[name="name"]', loo.name);
    await page.fill('input[name="notes"]', loo.notes!);
    
    // Set location
    await setMapLocation(page, loo.location!.lat, loo.location!.lng);
    
    // Set tri-state fields
    await setTriState(page, 'active', 'yes');
    await setTriState(page, 'accessible', 'yes');
    await setTriState(page, 'men', 'yes');
    await setTriState(page, 'women', 'yes');
    await setTriState(page, 'babyChange', 'yes');
    await setTriState(page, 'noPayment', 'yes');
    
    // Submit
    await submitLooForm(page);
    await waitForToast(page, 'created successfully');
  });

  test('should validate required name field', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Try to submit without name
    await submitLooForm(page);
    
    // Verify validation error
    await expectValidationError(page, 'name');
    
    // Verify toast shows error
    await waitForToast(page, 'validation errors');
  });

  test('should create loo with opening hours', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    const loo = generateLooWithOpeningHours();
    
    await page.fill('input[name="name"]', loo.name);
    
    // Set weekday hours (Mon-Fri)
    await setOpeningHours(page, 'monday', '09:00', '17:00');
    
    // Use "Copy to All" functionality
    await page.click('button:has-text("Copy to All")');
    
    // Mark weekends as closed
    await setDayClosed(page, 'saturday', true);
    await setDayClosed(page, 'sunday', true);
    
    await submitLooForm(page);
    await waitForToast(page, 'created successfully');
  });

  test('should toggle payment details visibility based on noPayment field', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    // Initially set to free (noPayment = yes)
    await setTriState(page, 'noPayment', 'yes');
    
    // Payment details should be hidden
    const paymentGroup = page.locator('#payment-details-group');
    await expect(paymentGroup).toHaveCSS('display', 'none');
    
    // Set to paid (noPayment = no)
    await setTriState(page, 'noPayment', 'no');
    
    // Payment details should be visible
    await expect(paymentGroup).not.toHaveCSS('display', 'none');
    await expect(page.locator('input[name="paymentDetails"]')).toBeVisible();
  });

  test('should create loo with payment details', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    const loo = generateLooWithPayment();
    
    await page.fill('input[name="name"]', loo.name);
    
    // Set as paid
    await setTriState(page, 'noPayment', 'no');
    
    // Fill payment details
    await page.fill('input[name="paymentDetails"]', loo.paymentDetails!);
    
    await submitLooForm(page);
    await waitForToast(page, 'created successfully');
  });

  test('should validate payment details required when not free', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.fill('input[name="name"]', 'Test Paid Loo');
    
    // Set as paid but don't fill payment details
    await setTriState(page, 'noPayment', 'no');
    
    // Try to submit
    await submitLooForm(page);
    
    // Verify validation error
    await expectValidationError(page, 'paymentDetails');
  });

  test('should handle special characters in name and notes', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    const loo = generateLooWithSpecialChars();
    
    await page.fill('input[name="name"]', loo.name);
    await page.fill('input[name="notes"]', loo.notes!);
    
    await submitLooForm(page);
    await waitForToast(page, 'created successfully');
  });

  test('should create loo at edge location (date line)', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    const loo = generateLooAtDateLine();
    
    await page.fill('input[name="name"]', loo.name);
    await setMapLocation(page, loo.location!.lat, loo.location!.lng);
    
    // Verify coordinates are displayed correctly
    const coordsDisplay = page.locator('#map-coords-display');
    await expect(coordsDisplay).toContainText('179.999');
    
    await submitLooForm(page);
    await waitForToast(page, 'created successfully');
  });

  test('should create loo at extreme latitude (north pole)', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    const loo = generateLooAtNorthPole();
    
    await page.fill('input[name="name"]', loo.name);
    await setMapLocation(page, loo.location!.lat, loo.location!.lng);
    
    await submitLooForm(page);
    await waitForToast(page, 'created successfully');
  });

  test('should validate latitude range (-90 to 90)', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.fill('input[name="name"]', 'Invalid Lat Loo');
    
    // Try invalid latitude > 90
    await setMapLocation(page, 91, 0);
    await submitLooForm(page);
    await expectValidationError(page, 'lat');
    
    // Try invalid latitude < -90
    await setMapLocation(page, -91, 0);
    await submitLooForm(page);
    await expectValidationError(page, 'lat');
  });

  test('should validate longitude range (-180 to 180)', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.fill('input[name="name"]', 'Invalid Lng Loo');
    
    // Try invalid longitude > 180
    await setMapLocation(page, 0, 181);
    await submitLooForm(page);
    await expectValidationError(page, 'lng');
    
    // Try invalid longitude < -180
    await setMapLocation(page, 0, -181);
    await submitLooForm(page);
    await expectValidationError(page, 'lng');
  });

  test('should validate both lat and lng required together', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.fill('input[name="name"]', 'Partial Location Loo');
    
    // Set only latitude
    await page.fill('input[name="lat"]', '51.5074');
    await page.fill('input[name="lng"]', '');
    
    await submitLooForm(page);
    await expectValidationError(page, 'lng');
  });

  test('should validate opening hours (open before close)', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.fill('input[name="name"]', 'Invalid Hours Loo');
    
    // Set closing time before opening time
    await setOpeningHours(page, 'monday', '17:00', '09:00');
    
    await submitLooForm(page);
    await expectValidationError(page, 'openingHours.monday.open');
  });

  test('should validate both open and close times required', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.fill('input[name="name"]', 'Partial Hours Loo');
    
    // Set only open time
    await page.fill('input[name="openingHours.monday.open"]', '09:00');
    await page.fill('input[name="openingHours.monday.close"]', '');
    
    await submitLooForm(page);
    await expectValidationError(page, 'openingHours.monday.open');
  });

  test('should handle closed day checkbox correctly', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.fill('input[name="name"]', 'Weekend Closed Loo');
    
    // Set hours for Monday
    await setOpeningHours(page, 'monday', '09:00', '17:00');
    
    // Mark Saturday as closed
    await setDayClosed(page, 'saturday', true);
    
    // Verify time inputs are disabled
    const saturdayOpen = page.locator('input[name="openingHours.saturday.open"]');
    await expect(saturdayOpen).toBeDisabled();
    
    await submitLooForm(page);
    await waitForToast(page, 'created successfully');
  });

  test('should use "Set Weekday Hours" helper', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.fill('input[name="name"]', 'Weekday Hours Loo');
    
    // Set Monday hours
    await setOpeningHours(page, 'monday', '09:00', '17:00');
    
    // Click "Set Weekday Hours" button
    await page.click('button:has-text("Set Weekday Hours")');
    
    // Verify Friday has same hours
    const fridayOpen = page.locator('input[name="openingHours.friday.open"]');
    await expect(fridayOpen).toHaveValue('09:00');
    
    // Verify Saturday is marked closed
    const saturdayClosed = page.locator('input[name="openingHours.saturday.closed"]');
    await expect(saturdayClosed).toBeChecked();
    
    await submitLooForm(page);
    await waitForToast(page, 'created successfully');
  });

  test('should use "Clear All Hours" helper', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.fill('input[name="name"]', 'Clear Hours Loo');
    
    // Set some hours
    await setOpeningHours(page, 'monday', '09:00', '17:00');
    await setOpeningHours(page, 'tuesday', '10:00', '16:00');
    
    // Click "Clear All" button
    await page.click('button:has-text("Clear All")');
    
    // Verify all hours are cleared
    const mondayOpen = page.locator('input[name="openingHours.monday.open"]');
    await expect(mondayOpen).toHaveValue('');
  });

  test('should cancel creation and return to list', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    await page.fill('input[name="name"]', 'Cancelled Loo');
    
    // Click back button
    await clickBackToList(page);
    
    // Verify back on list view
    await expect(page.locator('loo-list')).toBeVisible();
  });

  test('should update map coordinates display when panning', async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    
    const coordsDisplay = page.locator('#map-coords-display');
    const initialCoords = await coordsDisplay.textContent();
    
    // Pan the map by changing coordinates
    await setMapLocation(page, 52.0, -1.0);
    
    // Verify display updated
    const newCoords = await coordsDisplay.textContent();
    expect(newCoords).not.toBe(initialCoords);
    expect(newCoords).toContain('52.000000');
    expect(newCoords).toContain('-1.000000');
  });
});
