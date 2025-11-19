import { eventBus } from '../utils/EventBus.js';
import { authService } from '../services/AuthService.js';
import { componentRegistry, getNextComponentId } from '../utils/registry.js';

export class AdminSidebar extends HTMLElement {
  constructor() {
    super();
    this.componentId = getNextComponentId('sidebar');
  }

  connectedCallback() {
    componentRegistry.set(this.componentId, this);
    this.render();
  }

  disconnectedCallback() {
    componentRegistry.delete(this.componentId);
  }

  navigate(view) {
    eventBus.emit('view-changed', { view });
  }

  render() {
    this.innerHTML = `
      <aside style="width: 240px; background: white; border-right: 2px solid var(--color-border); padding: var(--space-m); height: 100vh; position: sticky; top: 0; display: flex; flex-direction: column;">
        <h2 style="margin-bottom: var(--space-l); font-size: var(--text-2); color: var(--color-blue); font-weight: 700;">
          <i class="fas fa-toilet"></i> Admin Panel
        </h2>
        <nav style="display: flex; flex-direction: column; gap: var(--space-xs); flex: 1;">
          <button class="btn-secondary" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').navigate('list'))" style="justify-content: flex-start; text-align: left;">
            <i class="fas fa-list" style="width: 1.25rem;"></i> Loo List
          </button>
          <button class="btn-secondary" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').navigate('map'))" style="justify-content: flex-start; text-align: left;">
            <i class="fas fa-map-marked-alt" style="width: 1.25rem;"></i> Map View
          </button>
          <button class="btn-secondary" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').navigate('stats'))" style="justify-content: flex-start; text-align: left;">
            <i class="fas fa-chart-bar" style="width: 1.25rem;"></i> Statistics
          </button>
          <button class="btn-secondary" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').navigate('suspicious'))" style="justify-content: flex-start; text-align: left;">
            <i class="fas fa-shield-alt" style="width: 1.25rem;"></i> Suspicious Activity
          </button>
          <button class="btn-secondary" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').navigate('contributors'))" style="justify-content: flex-start; text-align: left;">
            <i class="fas fa-users" style="width: 1.25rem;"></i> Contributors
          </button>
          <button class="btn-primary" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').navigate('edit'))" style="justify-content: flex-start; text-align: left; margin-top: var(--space-s);">
            <i class="fas fa-plus-circle" style="width: 1.25rem;"></i> Add New Loo
          </button>
        </nav>
        <div style="padding-top: var(--space-m); border-top: 2px solid var(--color-border);">
          <button class="btn-secondary" onclick="import('/admin/services/AuthService.js').then(m => m.authService.logout())" style="width: 100%;">
            <i class="fas fa-sign-out-alt" style="width: 1.25rem;"></i> Sign Out
          </button>
        </div>
      </aside>
    `;
  }
}

customElements.define('admin-sidebar', AdminSidebar);
