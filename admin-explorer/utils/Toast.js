export class Toast {
  static show(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div style="display: flex; align-items: start; gap: 0.75rem;">
        <div style="font-size: 1.25rem;">
          ${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}
        </div>
        <div style="flex: 1;">
          <div style="font-weight: 600; margin-bottom: 0.25rem;">
            ${type === 'success' ? 'Success' : type === 'error' ? 'Error' : 'Info'}
          </div>
          <div style="font-size: 0.875rem; color: var(--color-text-secondary);">
            ${message}
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}
