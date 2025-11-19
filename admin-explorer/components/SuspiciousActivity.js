import { apiService } from '../services/ApiService.js';
import { eventBus } from '../utils/EventBus.js';
import { componentRegistry, getNextComponentId } from '../utils/registry.js';

export class SuspiciousActivity extends HTMLElement {
  constructor() {
    super();
    this.componentId = getNextComponentId('suspicious');
    this.loading = true;
    this.data = null;
    this.error = null;
    this.hoursWindow = 24;
  }

  async connectedCallback() {
    componentRegistry.set(this.componentId, this);
    await this.loadData();
  }

  disconnectedCallback() {
    componentRegistry.delete(this.componentId);
  }

  async loadData() {
    try {
      this.loading = true;
      this.render();

      const params = new URLSearchParams({
        hoursWindow: this.hoursWindow.toString(),
      });
      const response = await apiService.get(`/admin/api/suspicious-activity?${params}`);
      this.data = response;
      this.error = null;
    } catch (error) {
      console.error('Failed to load suspicious activity:', error);
      this.error = error.message;
    } finally {
      this.loading = false;
      this.render();
    }
  }

  setTimeWindow(hours) {
    this.hoursWindow = hours;
    this.loadData();
  }

  render() {
    if (this.loading) {
      this.innerHTML = `
        <div style="max-width: 1400px;">
          <h1 style="font-size: 1.5rem; margin-bottom: 2rem;">
            <i class="fas fa-shield-alt"></i> Suspicious Activity Monitor
          </h1>
          <div style="text-align: center; padding: 3rem;">
            <i class="fas fa-spinner fa-spin" style="font-size: 2rem; color: var(--color-primary);"></i>
            <p style="margin-top: 1rem; color: var(--color-text-secondary);">Loading activity data...</p>
          </div>
        </div>
      `;
      return;
    }

    if (this.error) {
      this.innerHTML = `
        <div style="max-width: 1400px;">
          <h1 style="font-size: 1.5rem; margin-bottom: 2rem;">
            <i class="fas fa-shield-alt"></i> Suspicious Activity Monitor
          </h1>
          <div style="padding: 2rem; background: var(--color-danger); color: white; border-radius: var(--radius-md);">
            <i class="fas fa-exclamation-triangle"></i> Error: ${this.error}
          </div>
        </div>
      `;
      return;
    }

    const { rapidUpdates, conflictingEdits, locationChanges, massDeactivations } = this.data;
    const totalIssues = rapidUpdates.length + conflictingEdits.length + locationChanges.length + massDeactivations.length;

    this.innerHTML = `
      <div style="max-width: 1400px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
          <h1 style="font-size: 1.5rem;">
            <i class="fas fa-shield-alt"></i> Suspicious Activity Monitor
          </h1>
          <div style="display: flex; gap: var(--space-s); align-items: center;">
            <label style="color: var(--color-text-secondary); font-size: var(--text--1);">Time Window:</label>
            <select onchange="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').setTimeWindow(parseInt(this.value)))"
                    style="padding: var(--space-2xs) var(--space-xs); border-radius: var(--radius-md); border: 2px solid var(--color-border);">
              <option value="6" ${this.hoursWindow === 6 ? 'selected' : ''}>Last 6 hours</option>
              <option value="12" ${this.hoursWindow === 12 ? 'selected' : ''}>Last 12 hours</option>
              <option value="24" ${this.hoursWindow === 24 ? 'selected' : ''}>Last 24 hours</option>
              <option value="48" ${this.hoursWindow === 48 ? 'selected' : ''}>Last 48 hours</option>
              <option value="168" ${this.hoursWindow === 168 ? 'selected' : ''}>Last 7 days</option>
            </select>
            <button class="btn-secondary btn-sm" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').loadData())">
              <i class="fas fa-sync"></i> Refresh
            </button>
          </div>
        </div>

        ${totalIssues === 0 ? `
          <div style="text-align: center; padding: 3rem; background: var(--color-bg-secondary); border-radius: var(--radius-lg); border: 2px solid var(--color-border);">
            <i class="fas fa-check-circle" style="font-size: 3rem; color: var(--color-success);"></i>
            <h2 style="margin-top: 1rem; font-size: var(--text-2); color: var(--color-text);">All Clear!</h2>
            <p style="color: var(--color-text-secondary); margin-top: 0.5rem;">No suspicious activity detected in the last ${this.hoursWindow} hours.</p>
          </div>
        ` : `
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1rem; margin-bottom: 2rem;">
            <div style="background: ${rapidUpdates.length > 0 ? 'var(--color-danger)' : 'var(--color-success)'}; color: white; padding: 1.5rem; border-radius: var(--radius-md);">
              <div style="font-size: 2rem; font-weight: 700;">${rapidUpdates.length}</div>
              <div style="margin-top: 0.5rem;">Rapid Updates</div>
            </div>
            <div style="background: ${conflictingEdits.length > 0 ? 'var(--color-danger)' : 'var(--color-success)'}; color: white; padding: 1.5rem; border-radius: var(--radius-md);">
              <div style="font-size: 2rem; font-weight: 700;">${conflictingEdits.length}</div>
              <div style="margin-top: 0.5rem;">Conflicting Edits</div>
            </div>
            <div style="background: ${locationChanges.length > 0 ? 'var(--color-danger)' : 'var(--color-success)'}; color: white; padding: 1.5rem; border-radius: var(--radius-md);">
              <div style="font-size: 2rem; font-weight: 700;">${locationChanges.length}</div>
              <div style="margin-top: 0.5rem;">Location Changes</div>
            </div>
            <div style="background: ${massDeactivations.length > 0 ? 'var(--color-danger)' : 'var(--color-success)'}; color: white; padding: 1.5rem; border-radius: var(--radius-md);">
              <div style="font-size: 2rem; font-weight: 700;">${massDeactivations.length}</div>
              <div style="margin-top: 0.5rem;">Mass Deactivations</div>
            </div>
          </div>

          ${rapidUpdates.length > 0 ? `
            <div style="margin-bottom: 2rem;">
              <h2 style="font-size: var(--text-1); margin-bottom: 1rem; display: flex; align-items: center; gap: var(--space-xs);">
                <i class="fas fa-bolt"></i> Rapid Updates
              </h2>
              <div style="background: white; border-radius: var(--radius-md); border: 2px solid var(--color-border); overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse;">
                  <thead style="background: var(--color-bg-secondary);">
                    <tr>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Loo</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Updates</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Contributors</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Time Span</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rapidUpdates.map((item) => `
                      <tr style="border-top: 1px solid var(--color-border);">
                        <td style="padding: 1rem;">
                          <div style="font-weight: 600;">${item.looName || 'Unnamed'}</div>
                          <div style="font-size: var(--text--1); color: var(--color-text-secondary);">${item.looId}</div>
                        </td>
                        <td style="padding: 1rem;">
                          <span style="background: var(--color-danger); color: white; padding: 0.25rem 0.5rem; border-radius: var(--radius-full); font-size: var(--text--1); font-weight: 600;">
                            ${item.updateCount} updates
                          </span>
                        </td>
                        <td style="padding: 1rem;">
                          <div style="font-size: var(--text--1);">${item.contributors.join(', ')}</div>
                        </td>
                        <td style="padding: 1rem;">
                          <div>${item.timeSpanMinutes} minutes</div>
                          <div style="font-size: var(--text--1); color: var(--color-text-secondary);">
                            ${new Date(item.lastUpdate).toLocaleString()}
                          </div>
                        </td>
                        <td style="padding: 1rem;">
                          <button class="btn-sm btn-secondary" onclick="import('../utils/EventBus.js').then(m => m.eventBus.emit('view-changed', { view: 'edit', looId: '${item.looId}' }))">
                            <i class="fas fa-eye"></i> View
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}

          ${conflictingEdits.length > 0 ? `
            <div style="margin-bottom: 2rem;">
              <h2 style="font-size: var(--text-1); margin-bottom: 1rem; display: flex; align-items: center; gap: var(--space-xs);">
                <i class="fas fa-code-branch"></i> Conflicting Edits
              </h2>
              <div style="background: white; border-radius: var(--radius-md); border: 2px solid var(--color-border); overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse;">
                  <thead style="background: var(--color-bg-secondary);">
                    <tr>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Loo</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Field</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Conflicts</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Recent Changes</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${conflictingEdits.map((item) => `
                      <tr style="border-top: 1px solid var(--color-border);">
                        <td style="padding: 1rem;">
                          <div style="font-weight: 600;">${item.looName || 'Unnamed'}</div>
                          <div style="font-size: var(--text--1); color: var(--color-text-secondary);">${item.looId}</div>
                        </td>
                        <td style="padding: 1rem;">
                          <code style="background: var(--color-bg-secondary); padding: 0.25rem 0.5rem; border-radius: var(--radius-sm); font-size: var(--text--1);">
                            ${item.field}
                          </code>
                        </td>
                        <td style="padding: 1rem;">
                          <span style="background: var(--color-danger); color: white; padding: 0.25rem 0.5rem; border-radius: var(--radius-full); font-size: var(--text--1); font-weight: 600;">
                            ${item.conflictCount} values
                          </span>
                        </td>
                        <td style="padding: 1rem;">
                          <div style="font-size: var(--text--1);">
                            ${item.contributors.slice(0, 2).map(c => `${c.name}: ${JSON.stringify(c.value)}`).join('<br>')}
                            ${item.contributors.length > 2 ? `<br>+${item.contributors.length - 2} more` : ''}
                          </div>
                        </td>
                        <td style="padding: 1rem;">
                          <button class="btn-sm btn-secondary" onclick="import('../utils/EventBus.js').then(m => m.eventBus.emit('view-changed', { view: 'edit', looId: '${item.looId}' }))">
                            <i class="fas fa-eye"></i> View
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}

          ${locationChanges.length > 0 ? `
            <div style="margin-bottom: 2rem;">
              <h2 style="font-size: var(--text-1); margin-bottom: 1rem; display: flex; align-items: center; gap: var(--space-xs);">
                <i class="fas fa-location-arrow"></i> Significant Location Changes
              </h2>
              <div style="background: white; border-radius: var(--radius-md); border: 2px solid var(--color-border); overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse;">
                  <thead style="background: var(--color-bg-secondary);">
                    <tr>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Loo</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Contributor</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Distance Moved</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">When</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${locationChanges.map((item) => `
                      <tr style="border-top: 1px solid var(--color-border);">
                        <td style="padding: 1rem;">
                          <div style="font-weight: 600;">${item.looName || 'Unnamed'}</div>
                          <div style="font-size: var(--text--1); color: var(--color-text-secondary);">${item.looId}</div>
                        </td>
                        <td style="padding: 1rem;">${item.contributor}</td>
                        <td style="padding: 1rem;">
                          <span style="background: var(--color-danger); color: white; padding: 0.25rem 0.5rem; border-radius: var(--radius-full); font-size: var(--text--1); font-weight: 600;">
                            ${(item.distanceMeters / 1000).toFixed(2)} km
                          </span>
                        </td>
                        <td style="padding: 1rem;">
                          <div style="font-size: var(--text--1);">${new Date(item.timestamp).toLocaleString()}</div>
                        </td>
                        <td style="padding: 1rem;">
                          <button class="btn-sm btn-secondary" onclick="import('../utils/EventBus.js').then(m => m.eventBus.emit('view-changed', { view: 'edit', looId: '${item.looId}' }))">
                            <i class="fas fa-eye"></i> View
                          </button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}

          ${massDeactivations.length > 0 ? `
            <div style="margin-bottom: 2rem;">
              <h2 style="font-size: var(--text-1); margin-bottom: 1rem; display: flex; align-items: center; gap: var(--space-xs);">
                <i class="fas fa-ban"></i> Mass Deactivations
              </h2>
              <div style="background: white; border-radius: var(--radius-md); border: 2px solid var(--color-border); overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse;">
                  <thead style="background: var(--color-bg-secondary);">
                    <tr>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Contributor</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Deactivations</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Time Span</th>
                      <th style="padding: 1rem; text-align: left; font-size: var(--text--1); font-weight: 600;">Period</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${massDeactivations.map((item) => `
                      <tr style="border-top: 1px solid var(--color-border);">
                        <td style="padding: 1rem;">
                          <div style="font-weight: 600;">${item.contributor}</div>
                        </td>
                        <td style="padding: 1rem;">
                          <span style="background: var(--color-danger); color: white; padding: 0.25rem 0.5rem; border-radius: var(--radius-full); font-size: var(--text--1); font-weight: 600;">
                            ${item.deactivationCount} loos
                          </span>
                        </td>
                        <td style="padding: 1rem;">${item.timeSpanMinutes} minutes</td>
                        <td style="padding: 1rem;">
                          <div style="font-size: var(--text--1); color: var(--color-text-secondary);">
                            ${new Date(item.firstDeactivation).toLocaleString()} - ${new Date(item.lastDeactivation).toLocaleString()}
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}
        `}
      </div>
    `;
  }
}

customElements.define('suspicious-activity', SuspiciousActivity);
