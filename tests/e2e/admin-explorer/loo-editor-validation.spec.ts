import { test, expect } from './fixtures/auth';
import {
  clickAddNewLoo,
  submitLooForm,
  setTriState,
  setOpeningHours,
  setMapLocation,
  expectValidationError,
  expectNoValidationErrors,
} from './helpers/ui-helpers';

test.describe('Loo Editor - Validation', () => {
  test.beforeEach(async ({ authenticatedPage }) => {
    const page = authenticatedPage;
    await clickAddNewLoo(page);
  });

  test.describe('Required Field Validation', () => {
    test('should require name field', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      // Try to submit empty form
      await submitLooForm(page);
      
      // Verify name field has error
      await expectValidationError(page, 'name');
    });

    test('should allow submission with only name', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      // Fill only required field
      await page.fill('input[name="name"]', 'Minimal Loo');
      
      // Should submit successfully
      await submitLooForm(page);
      await page.waitForTimeout(1000);
      
      // Should not have validation errors
      await expectNoValidationErrors(page);
    });
  });

  test.describe('Location Validation', () => {
    test('should validate latitude range minimum', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Test Loo');
      await setMapLocation(page, -91, 0);
      
      await submitLooForm(page);
      await expectValidationError(page, 'lat');
    });

    test('should validate latitude range maximum', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Test Loo');
      await setMapLocation(page, 91, 0);
      
      await submitLooForm(page);
      await expectValidationError(page, 'lat');
    });

    test('should accept valid latitude at boundaries', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Boundary Lat Loo');
      
      // Test at exactly 90
      await setMapLocation(page, 90, 0);
      await submitLooForm(page);
      await page.waitForTimeout(500);
      await expectNoValidationErrors(page);
      
      // Navigate back
      await page.click('button:has-text("Add New Loo")');
      await page.fill('input[name="name"]', 'Boundary Lat Loo 2');
      
      // Test at exactly -90
      await setMapLocation(page, -90, 0);
      await submitLooForm(page);
      await page.waitForTimeout(500);
      await expectNoValidationErrors(page);
    });

    test('should validate longitude range minimum', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Test Loo');
      await setMapLocation(page, 0, -181);
      
      await submitLooForm(page);
      await expectValidationError(page, 'lng');
    });

    test('should validate longitude range maximum', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Test Loo');
      await setMapLocation(page, 0, 181);
      
      await submitLooForm(page);
      await expectValidationError(page, 'lng');
    });

    test('should accept valid longitude at boundaries', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Boundary Lng Loo');
      
      // Test at exactly 180
      await setMapLocation(page, 0, 180);
      await submitLooForm(page);
      await page.waitForTimeout(500);
      await expectNoValidationErrors(page);
      
      // Navigate back
      await page.click('button:has-text("Add New Loo")');
      await page.fill('input[name="name"]', 'Boundary Lng Loo 2');
      
      // Test at exactly -180
      await setMapLocation(page, 0, -180);
      await submitLooForm(page);
      await page.waitForTimeout(500);
      await expectNoValidationErrors(page);
    });

    test('should require longitude when latitude is provided', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Test Loo');
      await page.fill('input[name="lat"]', '51.5');
      await page.fill('input[name="lng"]', '');
      
      await submitLooForm(page);
      await expectValidationError(page, 'lng');
    });

    test('should require latitude when longitude is provided', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Test Loo');
      await page.fill('input[name="lat"]', '');
      await page.fill('input[name="lng"]', '-0.1');
      
      await submitLooForm(page);
      await expectValidationError(page, 'lat');
    });
  });

  test.describe('Payment Details Validation', () => {
    test('should require payment details when noPayment is false', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Paid Loo');
      await setTriState(page, 'noPayment', 'no');
      // Don't fill payment details
      
      await submitLooForm(page);
      await expectValidationError(page, 'paymentDetails');
    });

    test('should not require payment details when noPayment is true', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Free Loo');
      await setTriState(page, 'noPayment', 'yes');
      
      await submitLooForm(page);
      await page.waitForTimeout(500);
      await expectNoValidationErrors(page);
    });

    test('should not require payment details when noPayment is unknown', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Unknown Payment Loo');
      await setTriState(page, 'noPayment', 'unknown');
      
      await submitLooForm(page);
      await page.waitForTimeout(500);
      await expectNoValidationErrors(page);
    });

    test('should clear payment details when changing to free', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      // Set to paid and fill details
      await setTriState(page, 'noPayment', 'no');
      await page.fill('input[name="paymentDetails"]', '20p');
      
      // Change to free
      await setTriState(page, 'noPayment', 'yes');
      
      // Verify payment details cleared
      const paymentInput = page.locator('input[name="paymentDetails"]');
      const value = await paymentInput.inputValue();
      expect(value).toBe('');
    });
  });

  test.describe('Opening Hours Validation', () => {
    test('should require close time when open time is provided', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Test Loo');
      await page.fill('input[name="openingHours.monday.open"]', '09:00');
      await page.fill('input[name="openingHours.monday.close"]', '');
      
      await submitLooForm(page);
      await expectValidationError(page, 'openingHours.monday.open');
    });

    test('should require open time when close time is provided', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Test Loo');
      await page.fill('input[name="openingHours.monday.open"]', '');
      await page.fill('input[name="openingHours.monday.close"]', '17:00');
      
      await submitLooForm(page);
      await expectValidationError(page, 'openingHours.monday.open');
    });

    test('should validate open time is before close time', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Test Loo');
      await setOpeningHours(page, 'monday', '18:00', '09:00');
      
      await submitLooForm(page);
      await expectValidationError(page, 'openingHours.monday.open');
    });

    test('should reject same open and close times', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Test Loo');
      await setOpeningHours(page, 'monday', '12:00', '12:00');
      
      await submitLooForm(page);
      await expectValidationError(page, 'openingHours.monday.open');
    });

    test('should accept valid opening hours', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Valid Hours Loo');
      await setOpeningHours(page, 'monday', '09:00', '17:00');
      
      await submitLooForm(page);
      await page.waitForTimeout(500);
      await expectNoValidationErrors(page);
    });

    test('should not validate closed days', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Closed Day Loo');
      
      // Mark Monday as closed (no times needed)
      const closedCheckbox = page.locator('input[name="openingHours.monday.closed"]');
      await closedCheckbox.check();
      
      await submitLooForm(page);
      await page.waitForTimeout(500);
      await expectNoValidationErrors(page);
    });

    test('should validate across multiple days', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Multi Day Loo');
      
      // Set valid hours for Monday
      await setOpeningHours(page, 'monday', '09:00', '17:00');
      
      // Set invalid hours for Tuesday
      await setOpeningHours(page, 'tuesday', '20:00', '10:00');
      
      await submitLooForm(page);
      await expectValidationError(page, 'openingHours.tuesday.open');
    });
  });

  test.describe('Error Display and Clearing', () => {
    test('should display validation errors with icons', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      // Submit without required field
      await submitLooForm(page);
      
      // Verify error has icon
      const errorMessage = page.locator('.form-error');
      await expect(errorMessage).toBeVisible();
      await expect(errorMessage.locator('.fa-exclamation-circle')).toBeVisible();
    });

    test('should add error class to form group', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await submitLooForm(page);
      
      // Verify form group has error class
      const formGroup = page.locator('.form-group:has(input[name="name"])');
      await expect(formGroup).toHaveClass(/has-error/);
    });

    test('should clear errors when field is fixed', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      // Trigger validation error
      await submitLooForm(page);
      await expectValidationError(page, 'name');
      
      // Fix the error
      await page.fill('input[name="name"]', 'Fixed Name');
      
      // Try to submit again
      await submitLooForm(page);
      
      // Error should be cleared
      await page.waitForTimeout(500);
      const errors = page.locator('.form-error');
      const errorCount = await errors.count();
      // Might still have errors for other fields, but name error should be gone
      expect(errorCount).toBeLessThanOrEqual(0);
    });

    test('should show multiple validation errors simultaneously', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      // Create multiple validation errors
      // No name (required)
      await setMapLocation(page, 95, 0); // Invalid lat
      await setTriState(page, 'noPayment', 'no'); // No payment details
      
      await submitLooForm(page);
      
      // Should show multiple errors
      const errors = page.locator('.form-error');
      const errorCount = await errors.count();
      expect(errorCount).toBeGreaterThan(1);
    });
  });

  test.describe('Edge Cases', () => {
    test('should handle very long name', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      const longName = 'A'.repeat(500);
      await page.fill('input[name="name"]', longName);
      
      // Should either accept or show validation
      await submitLooForm(page);
      await page.waitForTimeout(500);
    });

    test('should handle very long notes', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Long Notes Loo');
      const longNotes = 'N'.repeat(2000);
      await page.fill('textarea[name="notes"]', longNotes);
      
      await submitLooForm(page);
      await page.waitForTimeout(500);
    });

    test('should handle empty string vs null for optional fields', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Optional Fields Loo');
      
      // Leave optional fields empty
      await page.fill('textarea[name="notes"]', '');
      await page.fill('textarea[name="removalReason"]', '');
      
      await submitLooForm(page);
      await page.waitForTimeout(500);
      await expectNoValidationErrors(page);
    });

    test('should handle decimal coordinates', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Decimal Coords Loo');
      await setMapLocation(page, 51.507421, -0.127647);
      
      await submitLooForm(page);
      await page.waitForTimeout(500);
      await expectNoValidationErrors(page);
    });

    test('should handle coordinates with many decimal places', async ({ authenticatedPage }) => {
      const page = authenticatedPage;
      
      await page.fill('input[name="name"]', 'Precise Coords Loo');
      await setMapLocation(page, 51.50742123456789, -0.12764712345678);
      
      await submitLooForm(page);
      await page.waitForTimeout(500);
      await expectNoValidationErrors(page);
    });
  });
});
