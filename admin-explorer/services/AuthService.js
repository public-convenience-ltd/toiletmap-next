import { eventBus } from '../utils/EventBus.js';

export const ADMIN_ROLE_ID = 'access:admin';

export class AuthService {
  constructor() {
    this.accessToken = null;
    this.user = null;
    this.config = {
      enabled: document.body.dataset.auth0Enabled === 'true',
      clientId: document.body.dataset.auth0ClientId,
      authorizeUrl: document.body.dataset.auth0AuthorizeUrl,
      audience: document.body.dataset.auth0Audience,
      scope: document.body.dataset.auth0Scope,
      redirectUri: document.body.dataset.auth0RedirectUri,
    };
  }

  async init() {
    // Check if we're on the callback page
    const hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
      await this.handleCallback();
      return;
    }

    // Try to load token from storage
    const stored = localStorage.getItem('auth_token');
    if (stored) {
      try {
        const data = JSON.parse(stored);
        if (data.expiresAt > Date.now()) {
          this.accessToken = data.accessToken;
          await this.fetchUserInfo();
          return;
        }
      } catch (e) {
        localStorage.removeItem('auth_token');
      }
    }
  }

  async handleCallback() {
    const hash = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const accessToken = params.get('access_token');
    const expiresIn = parseInt(params.get('expires_in') || '3600', 10);

    if (accessToken) {
      this.accessToken = accessToken;
      localStorage.setItem('auth_token', JSON.stringify({
        accessToken,
        expiresAt: Date.now() + (expiresIn * 1000)
      }));

      await this.fetchUserInfo();

      // Clean up URL
      window.history.replaceState(null, '', '/admin');
    }
  }

  async fetchUserInfo() {
    if (!this.accessToken) return;

    try {
      // Decode JWT to get user info
      const payload = JSON.parse(atob(this.accessToken.split('.')[1]));
      this.user = {
        sub: payload.sub,
        permissions: payload['permissions'] || [],
      };
    } catch (e) {
      console.error('Failed to decode token:', e);
      this.logout();
    }
  }

  login() {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: 'token',
      redirect_uri: this.config.redirectUri,
      audience: this.config.audience,
      scope: this.config.scope,
    });

    window.location.href = `${this.config.authorizeUrl}?${params.toString()}`;
  }

  logout() {
    this.accessToken = null;
    this.user = null;
    localStorage.removeItem('auth_token');
    eventBus.emit('auth-changed', { authenticated: false });
  }

  isAuthenticated() {
    return !!this.accessToken && !!this.user;
  }

  hasAdminRole() {
    return this.user?.permissions?.includes(ADMIN_ROLE_ID);
  }

  getToken() {
    return this.accessToken;
  }
}

export const authService = new AuthService();
