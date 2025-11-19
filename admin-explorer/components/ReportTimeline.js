import { apiService } from '../services/ApiService.js';

export class ReportTimeline extends HTMLElement {
  constructor() {
    super();
    this.reports = [];
    this.loading = false;
  }

  static get observedAttributes() {
    return ['loo-id'];
  }

  async connectedCallback() {
    const looId = this.getAttribute('loo-id');
    if (looId) {
      await this.loadReports(looId);
    }
  }

  async loadReports(id) {
    this.loading = true;
    this.render();

    try {
      const response = await apiService.getLooReports(id, true);
      this.reports = response.data || [];
      this.loading = false;
      this.render();
    } catch (error) {
      console.error('Failed to load reports:', error);
      this.loading = false;
      this.render();
    }
  }

  formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  renderDiff(diff) {
    if (!diff || Object.keys(diff).length === 0) {
      return '<span style="color: var(--color-text-secondary); font-size: 0.875rem;">No changes</span>';
    }

    return Object.entries(diff).map(([field, change]) => {
      const formatValue = (val) => {
        if (val === null || val === undefined) return 'null';
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      };

      return `
        <div style="margin-bottom: 0.5rem; font-size: 0.875rem;">
          <strong>${field}:</strong>
          <span style="color: var(--color-danger); text-decoration: line-through;">${formatValue(change.previous)}</span>
          →
          <span style="color: var(--color-success);">${formatValue(change.current)}</span>
        </div>
      `;
    }).join('');
  }

  render() {
    this.innerHTML = `
      <div style="background: white; border-radius: var(--radius-lg); padding: 1.5rem; box-shadow: var(--shadow-sm); max-height: 800px; overflow-y: auto;">
        <h3 style="margin-bottom: 1rem; font-size: 1rem; font-weight: 600;">Report History</h3>

        ${this.loading ? `
          <div style="text-align: center; padding: 2rem;">
            <div class="loading"></div>
          </div>
        ` : `
          ${this.reports.length === 0 ? `
            <p style="color: var(--color-text-secondary); text-align: center; padding: 2rem;">
              No reports found
            </p>
          ` : `
            <div style="position: relative; padding-left: 1.5rem;">
              <div style="position: absolute; left: 0.25rem; top: 0; bottom: 0; width: 2px; background: var(--color-border);"></div>
              ${this.reports.map((report, index) => `
                <div style="position: relative; margin-bottom: ${index === this.reports.length - 1 ? '0' : '1.5rem'};">
                  <div style="position: absolute; left: -1.25rem; top: 0.25rem; width: 0.75rem; height: 0.75rem; border-radius: 50%; background: ${report.isSystemReport ? 'var(--color-warning)' : 'var(--color-primary)'}; border: 2px solid white;"></div>
                  <div style="background: var(--color-bg-secondary); border-radius: var(--radius-md); padding: 1rem;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem;">
                      <div>
                        <div style="font-size: 0.875rem; font-weight: 600; margin-bottom: 0.25rem;">
                          ${report.contributor || 'Unknown'}
                        </div>
                        <div style="font-size: 0.75rem; color: var(--color-text-secondary);">
                          ${this.formatDate(report.createdAt)}
                        </div>
                      </div>
                      ${report.isSystemReport ? `
                        <span style="font-size: 0.75rem; padding: 0.25rem 0.5rem; background: var(--color-warning); color: white; border-radius: var(--radius-sm);">
                          System
                        </span>
                      ` : ''}
                    </div>
                    ${this.renderDiff(report.diff)}
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        `}
      </div>
    `;
  }
}

customElements.define('report-timeline', ReportTimeline);
