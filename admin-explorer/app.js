import { authService } from './services/AuthService.js';
import { eventBus } from './utils/EventBus.js';
import { componentRegistry, getNextComponentId } from './utils/registry.js';

// Import components to register them
import './components/Sidebar.js';
import './components/LooList.js';
import './components/LooEditor.js';
import './components/LooMap.js';
import './components/AdminStats.js';
import './components/SuspiciousActivity.js';
import './components/ContributorStats.js';

class AdminApp extends HTMLElement {
  constructor() {
    super();
    this.componentId = getNextComponentId('app');
    this.currentView = 'list';
    this.viewParams = {};
    this.isAuthenticated = false;
  }

  async connectedCallback() {
    componentRegistry.set(this.componentId, this);
    
    // Listen for auth changes
    eventBus.on('auth-changed', (data) => {
      this.isAuthenticated = data.authenticated;
      this.render();
    });

    // Listen for view navigation
    eventBus.on('view-changed', (data) => {
      this.currentView = data.view;
      this.viewParams = data;
      this.render();
    });

    // Initialize auth
    await authService.init();
    this.isAuthenticated = authService.isAuthenticated();
    
    // Always render (will show login page if not authenticated)
    this.render();
  }

  disconnectedCallback() {
    componentRegistry.delete(this.componentId);
  }

  render() {
    if (!this.isAuthenticated) {
      this.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; height: 100vh; background: var(--color-bg);">
          <div style="text-align: center; padding: 3rem; background: white; border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); max-width: 400px;">
            <i class="fas fa-shield-alt" style="font-size: 4rem; color: var(--color-primary); margin-bottom: 1.5rem;"></i>
            <h1 style="font-size: 2rem; margin-bottom: 0.5rem; color: var(--color-text);">Admin Panel</h1>
            <p style="color: var(--color-text-secondary); margin-bottom: 2rem;">Sign in to access the toilet map administration tools</p>
            <button class="btn-primary" onclick="import('./services/AuthService.js').then(m => m.authService.login())" style="width: 100%; padding: 0.75rem; font-size: 1rem;">
              <i class="fas fa-sign-in-alt" style="margin-right: 0.5rem;"></i>
              Sign In
            </button>
          </div>
        </div>
      `;
      return;
    }

    if (!authService.hasAdminRole()) {
      this.innerHTML = `
        <div style="display: flex; justify-content: center; align-items: center; height: 100vh; background: var(--color-bg);">
          <div style="text-align: center; padding: 2rem; background: white; border-radius: var(--radius-lg); box-shadow: var(--shadow-md); max-width: 400px;">
            <i class="fas fa-lock" style="font-size: 3rem; color: var(--color-danger); margin-bottom: 1rem;"></i>
            <h1 style="font-size: 1.5rem; margin-bottom: 0.5rem;">Access Denied</h1>
            <p style="color: var(--color-text-secondary); margin-bottom: 1.5rem;">You do not have permission to access the admin panel.</p>
            <button class="btn-primary" onclick="import('./services/AuthService.js').then(m => m.authService.logout())">
              Sign Out
            </button>
          </div>
        </div>
      `;
      return;
    }

    this.innerHTML = `
      <div style="display: flex; min-height: 100vh; background: var(--color-bg);">
        <admin-sidebar></admin-sidebar>
        <main style="flex: 1; padding: var(--space-xl); overflow-y: auto;">
          ${this.renderView()}
        </main>
      </div>
    `;
  }

  renderView() {
    switch (this.currentView) {
      case 'list':
        return '<loo-list></loo-list>';
      case 'map':
        return '<loo-map></loo-map>';
      case 'stats':
        return '<admin-stats></admin-stats>';
      case 'suspicious':
        return '<suspicious-activity></suspicious-activity>';
      case 'contributors':
        return '<contributor-stats></contributor-stats>';
      case 'edit':
        return `<loo-editor ${this.viewParams.looId ? `loo-id="${this.viewParams.looId}"` : ''}></loo-editor>`;
      default:
        return '<loo-list></loo-list>';
    }
  }
}

customElements.define('admin-app', AdminApp);
