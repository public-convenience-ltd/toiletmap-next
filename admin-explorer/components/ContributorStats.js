import { apiService } from '../services/ApiService.js';
import { componentRegistry, getNextComponentId } from '../utils/registry.js';

export class ContributorStats extends HTMLElement {
  constructor() {
    super();
    this.componentId = getNextComponentId('contributors');
    this.loading = true;
    this.leaderboard = null;
    this.selectedContributor = null;
    this.contributorDetails = null;
    this.error = null;
  }

  async connectedCallback() {
    componentRegistry.set(this.componentId, this);
    await this.loadLeaderboard();
  }

  disconnectedCallback() {
    componentRegistry.delete(this.componentId);
  }

  async loadLeaderboard() {
    try {
      this.loading = true;
      this.render();

      const response = await apiService.get('/admin/api/contributors/leaderboard');
      this.leaderboard = response;
      this.error = null;
    } catch (error) {
      console.error('Failed to load contributor leaderboard:', error);
      this.error = error.message;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  async viewContributor(contributorId) {
    try {
      this.selectedContributor = contributorId;
      this.loading = true;
      this.render();

      const response = await apiService.get(`/admin/api/contributors/${contributorId}`);
      this.contributorDetails = response;
      this.error = null;
    } catch (error) {
      console.error('Failed to load contributor details:', error);
      this.error = error.message;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  backToLeaderboard() {
    this.selectedContributor = null;
    this.contributorDetails = null;
    this.render();
  }

  render() {
    if (this.loading) {
      this.innerHTML = `
        <div style="max-width: 1400px;">
          <h1 style="font-size: 1.5rem; margin-bottom: 2rem;">
            <i class="fas fa-users"></i> Contributors
          </h1>
          <div style="text-align: center; padding: 3rem;">
            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: var(--color-primary);"></i>
            <p style="margin-top: 1rem; color: var(--color-text-secondary);">Loading data...</p>
          </div>
        </div>
      `;
      return;
    }

    if (this.error) {
      this.innerHTML = `
        <div style="max-width: 1400px;">
          <h1 style="font-size: 1.5rem; margin-bottom: 2rem;">
            <i class="fas fa-users"></i> Contributors
          </h1>
          <div style="padding: 2rem; background: var(--color-danger); color: white; border-radius: var(--radius-md);">
            <i class="fas fa-exclamation-triangle"></i> Error: ${this.error}
          </div>
        </div>
      `;
      return;
    }

    if (this.selectedContributor && this.contributorDetails) {
      this.renderContributorDetails();
    } else {
      this.renderLeaderboard();
    }
  }

  renderLeaderboard() {
    this.innerHTML = `
      <div style="max-width: 1400px;">
        <h1 style="font-size: 1.5rem; margin-bottom: 2rem;">
          <i class="fas fa-users"></i> Contributors
        </h1>

        <div style="background: white; border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm);">
          <table style="width: 100%; border-collapse: collapse;">
            <thead style="background: var(--color-bg-secondary);">
              <tr>
                <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Rank</th>
                <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Contributor</th>
                <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Total Edits</th>
                <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Last Active</th>
                <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${this.leaderboard.map((contributor, index) => `
                <tr style="border-top: 1px solid var(--color-border);">
                  <td style="padding: 1rem;">
                    <div style="font-weight: 600; color: var(--color-text-secondary);">#${index + 1}</div>
                  </td>
                  <td style="padding: 1rem;">
                    <div style="font-weight: 600;">${contributor.name}</div>
                  </td>
                  <td style="padding: 1rem;">
                    <span style="background: var(--color-primary); color: white; padding: 0.25rem 0.5rem; border-radius: var(--radius-full); font-size: var(--text--1); font-weight: 600;">
                      ${contributor.count} edits
                    </span>
                  </td>
                  <td style="padding: 1rem;">
                    <div style="font-size: var(--text--1); color: var(--color-text-secondary);">
                      ${new Date(contributor.lastActive).toLocaleDateString()}
                    </div>
                  </td>
                  <td style="padding: 1rem;">
                    <button
                    class="btn-secondary btn-sm"
                    onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').viewContributor('${contributor.id.replace(/'/g, "\\'") }'))"
                  >
                    View Details
                  </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  renderContributorDetails() {
    const { details, recentActivity } = this.contributorDetails;

    this.innerHTML = `
      <div style="max-width: 1400px;">
        <button class="btn-secondary" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').backToLeaderboard())" style="margin-bottom: 2rem;">
          <i class="fas fa-arrow-left"></i> Back to Leaderboard
        </button>

        <div style="background: white; border-radius: var(--radius-lg); padding: 2rem; box-shadow: var(--shadow-sm); margin-bottom: 2rem;">
          <h1 style="font-size: 2rem; margin-bottom: 0.5rem;">${details.name}</h1>
          <div style="color: var(--color-text-secondary); margin-bottom: 2rem;">
            Contributor since ${new Date(details.firstActive).toLocaleDateString()}
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem;">
            <div class="stat-card" style="background: var(--color-bg-secondary);">
              <div style="font-size: 2rem; font-weight: 700; color: var(--color-primary);">${details.totalEdits}</div>
              <div class="stat-label">Total Edits</div>
            </div>
            <div class="stat-card" style="background: var(--color-bg-secondary);">
              <div style="font-size: 2rem; font-weight: 700; color: var(--color-success);">${details.createdCount}</div>
              <div class="stat-label">Loos Created</div>
            </div>
            <div class="stat-card" style="background: var(--color-bg-secondary);">
              <div style="font-size: 2rem; font-weight: 700; color: var(--color-blue);">${details.updatedCount}</div>
              <div class="stat-label">Loos Updated</div>
            </div>
          </div>
        </div>

        <h2 style="font-size: 1.5rem; margin-bottom: 1.5rem;">Recent Activity</h2>
        <div style="background: white; border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm);">
          <table style="width: 100%; border-collapse: collapse;">
            <thead style="background: var(--color-bg-secondary);">
              <tr>
                <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Action</th>
                <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Loo</th>
                <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Date</th>
                <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">View</th>
              </tr>
            </thead>
            <tbody>
              ${recentActivity.map(activity => `
                <tr style="border-top: 1px solid var(--color-border);">
                  <td style="padding: 1rem;">
                    <span style="
                      display: inline-block;
                      padding: 0.25rem 0.5rem;
                      border-radius: var(--radius-sm);
                      font-size: var(--text--1);
                      font-weight: 600;
                      background: ${activity.type === 'create' ? 'var(--color-success)' : 'var(--color-blue)'};
                      color: white;
                    ">
                      ${activity.type === 'create' ? 'Created' : 'Updated'}
                    </span>
                  </td>
                  <td style="padding: 1rem;">
                    <div style="font-weight: 600;">${activity.looName || 'Unnamed'}</div>
                    <div style="font-size: var(--text--1); color: var(--color-text-secondary);">${activity.looId}</div>
                  </td>
                  <td style="padding: 1rem;">
                    <div style="font-size: var(--text--1); color: var(--color-text-secondary);">
                      ${new Date(activity.timestamp).toLocaleString()}
                    </div>
                  </td>
                  <td style="padding: 1rem;">
                    <button class="btn-sm btn-secondary" onclick="import('/admin/utils/EventBus.js').then(m => m.eventBus.emit('view-changed', { view: 'edit', looId: '${activity.looId.replace(/'/g, "\\'")}' }))">
                      <i class="fas fa-eye"></i> View
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}

customElements.define('contributor-stats', ContributorStats);
