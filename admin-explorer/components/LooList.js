import { apiService } from '../services/ApiService.js';
import { Toast } from '../utils/Toast.js';
import { eventBus } from '../utils/EventBus.js';
import { componentRegistry, getNextComponentId } from '../utils/registry.js';

export class LooList extends HTMLElement {
  constructor() {
    super();
    this.componentId = getNextComponentId('list');
    this.loos = [];
    this.loading = false;
    this.page = 1;
    this.pageSize = 20;
    this.total = 0;
    this.searchTerm = '';
    this.filters = {
      active: 'any',
      accessible: 'any',
      verified: 'any',
    };
  }

  async connectedCallback() {
    componentRegistry.set(this.componentId, this);
    this.render();
    await this.loadLoos();
  }

  disconnectedCallback() {
    componentRegistry.delete(this.componentId);
  }

  async loadLoos() {
    this.loading = true;
    this.render();

    try {
      const params = {
        page: this.page,
        limit: this.pageSize,
        sort: 'updated-desc',
      };

      if (this.searchTerm) {
        params.search = this.searchTerm;
      }

      Object.entries(this.filters).forEach(([key, value]) => {
        if (value !== 'any') {
          params[key] = value;
        }
      });

      const response = await apiService.searchLoos(params);
      this.loos = response.data;
      this.total = response.total;
      this.loading = false;
      this.render();
    } catch (error) {
      console.error('Failed to load loos:', error);
      this.loading = false;
      this.render();
    }
  }

  handleSearch(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    this.searchTerm = formData.get('search');
    this.page = 1;
    this.loadLoos();
  }

  handleFilterChange(key, value) {
    this.filters[key] = value;
    this.page = 1;
    this.loadLoos();
  }

  changePage(newPage) {
    this.page = newPage;
    this.loadLoos();
  }

  viewLoo(id) {
    eventBus.emit('view-changed', { view: 'edit', looId: id });
  }

  async toggleActive(id, currentState) {
    const action = currentState ? 'deactivate' : 'activate';
    if (!confirm(`Are you sure you want to ${action} this loo?`)) {
      return;
    }

    try {
      await apiService.updateLoo(id, { active: !currentState });
      Toast.show(`Loo ${action}d successfully`, 'success');
      await this.loadLoos();
    } catch (error) {
      Toast.show(error.message || `Failed to ${action} loo`, 'error');
    }
  }

  render() {
    const totalPages = Math.ceil(this.total / this.pageSize);

    this.innerHTML = `
      <div style="max-width: 1200px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
          <h1 style="font-size: 1.5rem;">Loos (${this.total})</h1>
          <button class="btn-primary" onclick="import('../utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').viewLoo(null))">
            Add New Loo
          </button>
        </div>

        <div style="background: white; border-radius: var(--radius-lg); padding: 1.5rem; margin-bottom: 1.5rem; box-shadow: var(--shadow-sm);">
          <form onsubmit="import('../utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').handleSearch(event)); return false;">
            <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
              <input
                type="text"
                name="search"
                placeholder="Search by name, area, or notes..."
                value="${this.searchTerm}"
                style="flex: 1;"
              >
              <button type="submit" class="btn-primary">Search</button>
            </div>
            <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
              <div>
                <label>Active</label>
                <select onchange="import('../utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').handleFilterChange('active', this.value))">
                  <option value="any" ${this.filters.active === 'any' ? 'selected' : ''}>Any</option>
                  <option value="true" ${this.filters.active === 'true' ? 'selected' : ''}>Yes</option>
                  <option value="false" ${this.filters.active === 'false' ? 'selected' : ''}>No</option>
                </select>
              </div>
              <div>
                <label>Accessible</label>
                <select onchange="import('../utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').handleFilterChange('accessible', this.value))">
                  <option value="any" ${this.filters.accessible === 'any' ? 'selected' : ''}>Any</option>
                  <option value="true" ${this.filters.accessible === 'true' ? 'selected' : ''}>Yes</option>
                  <option value="false" ${this.filters.accessible === 'false' ? 'selected' : ''}>No</option>
                </select>
              </div>
              <div>
                <label>Verified</label>
                <select onchange="import('../utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').handleFilterChange('verified', this.value))">
                  <option value="any" ${this.filters.verified === 'any' ? 'selected' : ''}>Any</option>
                  <option value="true" ${this.filters.verified === 'true' ? 'selected' : ''}>Yes</option>
                  <option value="false" ${this.filters.verified === 'false' ? 'selected' : ''}>No</option>
                </select>
              </div>
            </div>
          </form>
        </div>

        ${this.loading ? `
          <div style="text-align: center; padding: 3rem;">
            <div class="loading" style="width: 2rem; height: 2rem;"></div>
          </div>
        ` : `
          <div style="background: white; border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm);">
            <table style="width: 100%; border-collapse: collapse;">
              <thead style="background: var(--color-bg-secondary); border-bottom: 1px solid var(--color-border);">
                <tr>
                  <th style="padding: 0.75rem; text-align: left; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-secondary);">Name</th>
                  <th style="padding: 0.75rem; text-align: left; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-secondary);">Area</th>
                  <th style="padding: 0.75rem; text-align: center; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-secondary);">Status</th>
                  <th style="padding: 0.75rem; text-align: center; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-secondary);">Features</th>
                  <th style="padding: 0.75rem; text-align: left; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-secondary);">Updated</th>
                  <th style="padding: 0.75rem; text-align: right; font-weight: 600; font-size: 0.75rem; text-transform: uppercase; color: var(--color-text-secondary);">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${this.loos.length === 0 ? `
                  <tr>
                    <td colspan="6" style="padding: 3rem; text-align: center; color: var(--color-text-secondary);">
                      No loos found
                    </td>
                  </tr>
                ` : this.loos.map(loo => `
                  <tr style="border-bottom: 1px solid var(--color-border);">
                    <td style="padding: 0.75rem;">
                      <div style="font-weight: 500;">${loo.name || 'Unnamed'}</div>
                      <div style="font-size: 0.75rem; color: var(--color-text-secondary);">${loo.id}</div>
                    </td>
                    <td style="padding: 0.75rem;">
                      <div style="font-size: 0.875rem;">${loo.area?.[0]?.name || 'No area'}</div>
                    </td>
                    <td style="padding: 0.75rem; text-align: center;">
                      ${loo.active ?
                        '<span style="display: inline-block; padding: 0.25rem 0.5rem; background: #d1fae5; color: #065f46; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 500;">Active</span>' :
                        '<span style="display: inline-block; padding: 0.25rem 0.5rem; background: #fee2e2; color: #991b1b; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 500;">Inactive</span>'
                      }
                    </td>
                    <td style="padding: 0.75rem; text-align: center;">
                      <div style="display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap;">
                        ${loo.accessible ? '<i class="fas fa-wheelchair" title="Accessible" style="color: var(--color-primary);"></i>' : ''}
                        ${loo.babyChange ? '<i class="fas fa-baby" title="Baby Change" style="color: var(--color-primary);"></i>' : ''}
                        ${loo.radar ? '<i class="fas fa-key" title="RADAR" style="color: var(--color-primary);"></i>' : ''}
                        ${loo.noPayment ? '<i class="fas fa-check-circle" title="Free" style="color: var(--color-success);"></i>' : ''}
                      </div>
                    </td>
                    <td style="padding: 0.75rem;">
                      <div style="font-size: 0.875rem;">${loo.updatedAt ? new Date(loo.updatedAt).toLocaleDateString() : 'N/A'}</div>
                    </td>
                    <td style="padding: 0.75rem; text-align: right;">
                      <div style="display: flex; gap: 0.5rem; justify-content: flex-end;">
                        <button
                          class="btn-sm btn-secondary"
                          onclick="import('../utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').viewLoo('${loo.id}'))"
                          title="View details"
                        >
                          <i class="fas fa-edit"></i> Edit
                        </button>
                        <button
                          class="btn-sm ${loo.active ? 'btn-danger' : 'btn-primary'}"
                          onclick="import('../utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').toggleActive('${loo.id}', ${loo.active}))"
                          title="${loo.active ? 'Deactivate' : 'Activate'}"
                        >
                          <i class="fas fa-${loo.active ? 'ban' : 'check'}"></i> ${loo.active ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>

          ${totalPages > 1 ? `
            <div style="display: flex; justify-content: center; align-items: center; gap: 0.5rem; margin-top: 1.5rem;">
              <button
                class="btn-secondary btn-sm"
                onclick="import('../utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').changePage(${this.page - 1}))"
                ${this.page === 1 ? 'disabled' : ''}
              >
                Previous
              </button>
              <span style="padding: 0 1rem; color: var(--color-text-secondary);">
                Page ${this.page} of ${totalPages}
              </span>
              <button
                class="btn-secondary btn-sm"
                onclick="import('../utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').changePage(${this.page + 1}))"
                ${this.page === totalPages ? 'disabled' : ''}
              >
                Next
              </button>
            </div>
          ` : ''}
        `}
      </div>
    `;
  }
}

customElements.define('loo-list', LooList);
