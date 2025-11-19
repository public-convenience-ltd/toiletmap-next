# Admin Explorer E2E Tests

Comprehensive end-to-end tests for the admin-explorer application using Playwright.

## Overview

This test suite provides thorough coverage of the admin-explorer interface, including:

- **Authentication** - Auth0 login, permissions, session persistence
- **Navigation** - Sidebar navigation, browser history, routing
- **Loo List View** - Search, filtering, pagination
- **Loo Editor** - Create/edit forms, validation, data manipulation
- **Map View** - Leaflet integration, markers, popups
- **Stats View** - Statistics display and metrics
- **Suspicious Activity** - Time window filtering, action buttons
- **Contributors View** - Leaderboard and statistics
- **Error Handling** - API errors, network failures, edge cases

## Setup

### Prerequisites

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure environment variables:**
   
   Copy `.env.example` to `.env` and add your Playwright Auth0 credentials:
   
   ```bash
   PLAYWRIGHT_AUTH0_USERNAME=your-test-user@example.com
   PLAYWRIGHT_AUTH0_PASSWORD=your-test-password
   ```
   
   The test user must have `access:admin` permission in Auth0.

3. **Ensure Auth0 Resource Owner Password Grant is enabled:**
   
   The tests use programmatic authentication to avoid UI login and captchas. This requires the Resource Owner Password Grant flow to be enabled in your Auth0 tenant.
   
   If this is not available, the tests will fall back to UI-based login (which may encounter captchas).

## Running Tests

### Run all tests
```bash
pnpm test:e2e:playwright
```

### Run specific test file
```bash
pnpm playwright test tests/e2e/admin-explorer/loo-editor-create.spec.ts
```

### Run in headed mode (see browser)
```bash
pnpm test:e2e:playwright:headed
```

### Run in UI mode (interactive debugging)
```bash
pnpm test:e2e:playwright:ui
```

### Run specific browsers
```bash
pnpm playwright test --project=chromium
pnpm playwright test --project=firefox
pnpm playwright test --project=webkit
```

## Test Structure

```
tests/e2e/admin-explorer/
├── fixtures/
│   ├── auth.ts              # Authentication fixtures
│   └── test-data.ts         # Test data generators
├── helpers/
│   └── ui-helpers.ts        # UI interaction helpers
├── auth.spec.ts             # Authentication tests
├── navigation.spec.ts       # Navigation and routing tests
├── loo-list.spec.ts         # Loo list view tests
├── loo-editor-create.spec.ts    # Create loo tests
├── loo-editor-edit.spec.ts      # Edit loo tests
├── loo-editor-validation.spec.ts # Validation tests
├── map.spec.ts              # Map view tests
├── stats.spec.ts            # Stats view tests
├── suspicious-activity.spec.ts  # Suspicious activity tests
├── contributors.spec.ts     # Contributors view tests
└── error-handling.spec.ts   # Error handling and edge cases
```

## Key Features

### Programmatic Authentication

Tests use Auth0's Resource Owner Password Grant flow to obtain access tokens programmatically, avoiding the need for UI-based login and potential captcha challenges.

### Test Data Generators

Reusable test data generators create valid and invalid loo objects for comprehensive testing:

```typescript
import { generateValidLoo, generateLooWithSpecialChars } from './fixtures/test-data';

const loo = generateValidLoo({ accessible: true });
```

### UI Helpers

Common UI interactions are abstracted into helper functions:

```typescript
import { clickAddNewLoo, setTriState, submitLooForm } from './helpers/ui-helpers';

await clickAddNewLoo(page);
await setTriState(page, 'accessible', 'yes');
await submitLooForm(page);
```

### Comprehensive Coverage

The loo editor tests (the most critical) include:
- All field types (text, tri-state, location, opening hours)
- Validation of all constraints
- Edge cases (special characters, boundary values, extreme locations)
- Map picker functionality
- Changes tracking and summary
- Form reset and navigation

## Viewing Test Reports

After running tests, view the HTML report:

```bash
pnpm playwright show-report
```

This provides:
- Test results summary
- Screenshots of failures
- Video recordings of failures
- Detailed test traces

## CI/CD Integration

Tests are configured to run in CI with:
- Sequential execution (no parallel tests)
- 2 retries on failure
- Screenshots and videos on failure
- HTML reporter artifacts

## Troubleshooting

### Authentication Failures

If tests fail with authentication errors:

1. Verify `PLAYWRIGHT_AUTH0_USERNAME` and `PLAYWRIGHT_AUTH0_PASSWORD` are set in `.env`
2. Confirm the test user has `access:admin` permission
3. Check if Resource Owner Password Grant is enabled in Auth0
4. Ensure `AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`, and `AUTH0_DATA_EXPLORER_CLIENT_ID` are correct

### Network Errors

If tests fail with network errors:

1. Ensure the dev server is running on `http://localhost:4001`
2. Check that Supabase is running
3. Verify database connectivity

### Flaky Tests

If tests are intermittently failing:

1. Increase timeouts in unreliable tests
2. Add explicit waits for network requests
3. Use Playwright's auto-waiting features
4. Run tests with `--workers=1` to avoid conflicts

## Writing New Tests

1. Create a new spec file in `tests/e2e/admin-explorer/`
2. Import fixtures and helpers:
   ```typescript
   import { test, expect } from '../fixtures/auth';
   import { navigateToView } from '../helpers/ui-helpers';
   ```
3. Use `authenticatedPage` fixture for tests requiring authentication
4. Follow existing patterns for consistency

## Best Practices

- Use `waitForLoadState('networkidle')` after navigation
- Prefer `locator()` over `$()` for better auto-waiting
- Use test data generators for consistency
- Keep tests independent (no shared state)
- Use descriptive test names
- Test both happy paths and edge cases
- Verify error messages and validation feedback
