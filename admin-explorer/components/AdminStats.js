import { apiService } from '../services/ApiService.js';
import { Toast } from '../utils/Toast.js';
import { componentRegistry, getNextComponentId } from '../utils/registry.js';

export class AdminStats extends HTMLElement {
  constructor() {
    super();
    this.componentId = getNextComponentId('stats');
    this.stats = null;
    this.loading = false;
  }

  async connectedCallback() {
    componentRegistry.set(this.componentId, this);
    this.render();
    await this.loadStats();
  }

  disconnectedCallback() {
    componentRegistry.delete(this.componentId);
  }

  async loadStats() {
    this.loading = true;
    this.render();

    try {
      // Use the dedicated admin stats endpoint
      const response = await apiService.getAdminStats();

      this.stats = {
        totalLoos: response.overview.totalLoos,
        activeLoos: response.overview.activeLoos,
        accessibleLoos: response.overview.accessibleLoos,
        verifiedLoos: response.overview.verifiedLoos,
        uniqueContributors: response.contributors.total,
        topContributors: response.contributors.topContributors,
        recentUpdates: response.activity.recentUpdates,
        updatesLast7Days: response.activity.updatesLast7Days,
        updatesLast30Days: response.activity.updatesLast30Days,
        avgUpdatesPerDay: response.activity.updatesLast30Days / 30
      };

      this.loading = false;
      this.render();
    } catch (error) {
      console.error('Failed to load stats:', error);
      Toast.show('Failed to load statistics', 'error');
      this.loading = false;
      this.render();
    }
  }

  render() {
    if (this.loading || !this.stats) {
      this.innerHTML = `
        <div style="text-align: center; padding: 3rem;">
          <div class="loading" style="width: 2rem; height: 2rem;"></div>
          <p style="margin-top: 1rem; color: var(--color-text-secondary);">Loading statistics...</p>
        </div>
      `;
      return;
    }

    this.innerHTML = `
      <div style="max-width: 1400px;">
        <h1 style="font-size: 1.5rem; margin-bottom: 2rem;">
          <i class="fas fa-chart-bar"></i> Statistics Dashboard
        </h1>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 2rem;">
          <div class="stat-card">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
              <i class="fas fa-toilet" style="font-size: 1.5rem; color: var(--color-primary);"></i>
              <div class="stat-value">${this.stats.totalLoos}</div>
            </div>
            <div class="stat-label">Total Loos</div>
          </div>

          <div class="stat-card">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
              <i class="fas fa-check-circle" style="font-size: 1.5rem; color: var(--color-success);"></i>
              <div class="stat-value">${this.stats.activeLoos}</div>
            </div>
            <div class="stat-label">Active Loos</div>
          </div>

          <div class="stat-card">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
              <i class="fas fa-wheelchair" style="font-size: 1.5rem; color: var(--color-primary);"></i>
              <div class="stat-value">${this.stats.accessibleLoos}</div>
            </div>
            <div class="stat-label">Accessible</div>
          </div>

          <div class="stat-card">
            <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
              <i class="fas fa-shield-alt" style="font-size: 1.5rem; color: var(--color-success);"></i>
              <div class="stat-value">${this.stats.verifiedLoos}</div>
            </div>
            <div class="stat-label">Verified</div>
          </div>
        </div>

        ${this.renderOverview()}
      </div>
    `;
  }

  renderOverview() {
    return `
      <div style="display: grid; gap: 2rem;">
        <div>
          <h3 style="margin-bottom: 1rem; font-size: 1.125rem; font-weight: 600;">
            <i class="fas fa-users"></i> Contributor Statistics
          </h3>
          <div style="background: var(--color-bg-secondary); border-radius: var(--radius-md); padding: 1.5rem;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 1.5rem;">
              <div>
                <div style="font-size: 1.5rem; font-weight: 600; color: var(--color-primary);">
                  ${this.stats.uniqueContributors || 'N/A'}
                </div>
                <div style="font-size: 0.875rem; color: var(--color-text-secondary);">Unique Contributors</div>
              </div>
              <div>
                <div style="font-size: 1.5rem; font-weight: 600; color: var(--color-primary);">
                  ${this.stats.avgUpdatesPerDay.toFixed(1)}
                </div>
                <div style="font-size: 0.875rem; color: var(--color-text-secondary);">Avg Updates/Day (30d)</div>
              </div>
            </div>
            ${this.stats.topContributors?.length > 0 ? `
              <div>
                <div style="font-weight: 600; margin-bottom: 0.75rem; font-size: 0.875rem; text-transform: uppercase; color: var(--color-text-secondary);">
                  Top Contributors
                </div>
                <div style="display: grid; gap: 0.5rem;">
                  ${this.stats.topContributors.slice(0, 5).map((contributor, index) => `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; background: white; border-radius: var(--radius-sm);">
                      <div style="display: flex; align-items: center; gap: 0.5rem;">
                        <span style="font-weight: 600; color: var(--color-text-secondary); min-width: 1.5rem;">${index + 1}.</span>
                        <span style="font-size: 0.875rem;">${contributor.name}</span>
                      </div>
                      <span style="font-weight: 600; color: var(--color-primary);">${contributor.count}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}
          </div>
        </div>

        <div>
          <h3 style="margin-bottom: 1rem; font-size: 1.125rem; font-weight: 600;">
            <i class="fas fa-chart-line"></i> Update Activity
          </h3>
          <div style="background: var(--color-bg-secondary); border-radius: var(--radius-md); padding: 1.5rem;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
              <div>
                <div style="font-size: 1.25rem; font-weight: 600; color: var(--color-primary);">
                  ${this.stats.updatesLast7Days}
                </div>
                <div style="font-size: 0.875rem; color: var(--color-text-secondary);">Last 7 Days</div>
              </div>
              <div>
                <div style="font-size: 1.25rem; font-weight: 600; color: var(--color-primary);">
                  ${this.stats.updatesLast30Days}
                </div>
                <div style="font-size: 0.875rem; color: var(--color-text-secondary);">Last 30 Days</div>
              </div>
            </div>
            <p style="color: var(--color-text-secondary); margin: 0; padding-top: 1rem; border-top: 1px solid var(--color-border);">
              Database contains ${this.stats.totalLoos} loos with ${this.stats.activeLoos} currently active.
              ${this.stats.verifiedLoos} loos have been verified by administrators.
            </p>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('admin-stats', AdminStats);
