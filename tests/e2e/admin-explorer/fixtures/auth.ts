import { test as base, expect, Page } from '@playwright/test';

/**
 * Authentication state for tests
 */
export interface AuthState {
  accessToken: string;
  expiresAt: number;
  user: {
    sub: string;
    permissions: string[];
  };
}

/**
 * Extended fixtures for admin-explorer tests
 */
export interface AdminExplorerFixtures {
  authenticatedPage: Page;
}

/**
 * Get Auth0 access token programmatically using Resource Owner Password Grant
 * This avoids UI login and potential captchas
 */
async function getAuth0Token(): Promise<AuthState> {
  const auth0Domain = process.env.AUTH0_ISSUER_BASE_URL?.replace(/\/$/, '');
  const audience = process.env.AUTH0_AUDIENCE;
  const clientId = process.env.AUTH0_DATA_EXPLORER_CLIENT_ID;
  const username = process.env.PLAYWRIGHT_AUTH0_USERNAME;
  const password = process.env.PLAYWRIGHT_AUTH0_PASSWORD;

  if (!auth0Domain || !audience || !clientId || !username || !password) {
    throw new Error(
      'Missing required Auth0 environment variables. Please ensure PLAYWRIGHT_AUTH0_USERNAME and PLAYWRIGHT_AUTH0_PASSWORD are set in .env'
    );
  }

  try {
    // Try programmatic authentication using Resource Owner Password Grant
    const response = await fetch(`${auth0Domain}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'password',
        username,
        password,
        audience,
        client_id: clientId,
        scope: 'openid profile email offline_access',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Auth0 token request failed: ${response.status} ${error}`);
    }

    const data = await response.json();
    const accessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;

    // Decode JWT to get user info
    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    
    return {
      accessToken,
      expiresAt: Date.now() + expiresIn * 1000,
      user: {
        sub: payload.sub,
        permissions: payload.permissions || [],
      },
    };
  } catch (error) {
    throw new Error(
      `Failed to obtain Auth0 token programmatically. ` +
      `This may mean Resource Owner Password Grant is not enabled on your Auth0 tenant. ` +
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Inject authentication state into page
 */
async function injectAuthState(page: Page, authState: AuthState): Promise<void> {
  await page.goto('/admin');
  
  // Inject token into localStorage
  await page.evaluate((state) => {
    localStorage.setItem('auth_token', JSON.stringify({
      accessToken: state.accessToken,
      expiresAt: state.expiresAt,
    }));
  }, authState);
  
  // Reload to apply auth state
  await page.reload();
  await page.waitForLoadState('networkidle');
}

// Cache auth token to avoid repeated authentication
let cachedAuthState: AuthState | null = null;

/**
 * Extended test with authenticated page fixture
 */
export const test = base.extend<AdminExplorerFixtures>({
  authenticatedPage: async ({ page }, use) => {
    // Get or reuse cached auth token
    if (!cachedAuthState || cachedAuthState.expiresAt < Date.now() + 60000) {
      cachedAuthState = await getAuth0Token();
    }

    // Inject auth state into page
    await injectAuthState(page, cachedAuthState);

    // Verify we're authenticated
    const adminApp = page.locator('admin-app');
    await expect(adminApp).toBeVisible({ timeout: 10000 });

    // Use the authenticated page
    await use(page);
  },
});

export { expect };
