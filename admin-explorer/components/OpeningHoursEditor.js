import { Toast } from '../utils/Toast.js';

export class OpeningHoursEditor extends HTMLElement {
  constructor() {
    super();
    this.openingTimes = {};
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
  }

  set value(times) {
    this.openingTimes = times || {};
    this.render();
    this.setupEventListeners();
  }

  get value() {
    const times = {};
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
      const is24Hours = this.querySelector(`input[name="openingHours.${day}.24hours"]`)?.checked;
      const closed = this.querySelector(`input[name="openingHours.${day}.closed"]`)?.checked;
      const open = this.querySelector(`input[name="openingHours.${day}.open"]`)?.value;
      const close = this.querySelector(`input[name="openingHours.${day}.close"]`)?.value;

      if (is24Hours) {
        times[day] = ['00:00', '00:00'];
      } else if (closed) {
        times[day] = [];
      } else if (open && close) {
        times[day] = [open, close];
      } else {
        times[day] = []; // Default to closed/unknown if incomplete
      }
    });
    return times;
  }

  setupEventListeners() {
    // Event delegation for day toggles
    this.addEventListener('change', (e) => {
      const target = e.target;
      if (target.matches('input[type="checkbox"]')) {
        const name = target.name;
        if (name.includes('.closed') || name.includes('.24hours')) {
          const day = name.split('.')[1];
          this.toggleDayInputs(day);
          
          // Ensure mutual exclusivity
          if (target.checked) {
            if (name.includes('.closed')) {
              const hours24 = this.querySelector(`input[name="openingHours.${day}.24hours"]`);
              if (hours24) hours24.checked = false;
            } else {
              const closed = this.querySelector(`input[name="openingHours.${day}.closed"]`);
              if (closed) closed.checked = false;
            }
          }
        }
      }
    });

    // Global actions
    this.querySelector('#btn-copy-mon')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.copyHoursToAll('monday');
    });

    this.querySelector('#btn-clear-hours')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.clearAllHours();
    });

    this.querySelector('#btn-set-weekdays')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.setWeekdayHours();
    });
  }

  toggleDayInputs(day) {
    const closedCheckbox = this.querySelector(`input[name="openingHours.${day}.closed"]`);
    const is24HoursCheckbox = this.querySelector(`input[name="openingHours.${day}.24hours"]`);
    const openInput = this.querySelector(`input[name="openingHours.${day}.open"]`);
    const closeInput = this.querySelector(`input[name="openingHours.${day}.close"]`);

    if (closedCheckbox && is24HoursCheckbox && openInput && closeInput) {
      const isClosed = closedCheckbox.checked;
      const is24Hours = is24HoursCheckbox.checked;

      if (isClosed || is24Hours) {
        if (openInput.value) openInput.dataset.savedValue = openInput.value;
        if (closeInput.value) closeInput.dataset.savedValue = closeInput.value;
        openInput.value = '';
        closeInput.value = '';
        openInput.disabled = true;
        closeInput.disabled = true;
      } else {
        if (openInput.dataset.savedValue) {
          openInput.value = openInput.dataset.savedValue;
          delete openInput.dataset.savedValue;
        }
        if (closeInput.dataset.savedValue) {
          closeInput.value = closeInput.dataset.savedValue;
          delete closeInput.dataset.savedValue;
        }
        openInput.disabled = false;
        closeInput.disabled = false;
      }
    }
  }

  copyHoursToAll(sourceDay) {
    const openInput = this.querySelector(`input[name="openingHours.${sourceDay}.open"]`);
    const closeInput = this.querySelector(`input[name="openingHours.${sourceDay}.close"]`);
    const closedCheckbox = this.querySelector(`input[name="openingHours.${sourceDay}.closed"]`);
    const is24HoursCheckbox = this.querySelector(`input[name="openingHours.${sourceDay}.24hours"]`);

    if (!openInput || !closeInput || !closedCheckbox || !is24HoursCheckbox) return;

    const openValue = openInput.value;
    const closeValue = closeInput.value;
    const closedValue = closedCheckbox.checked;
    const is24HoursValue = is24HoursCheckbox.checked;

    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
      const dayOpenInput = this.querySelector(`input[name="openingHours.${day}.open"]`);
      const dayCloseInput = this.querySelector(`input[name="openingHours.${day}.close"]`);
      const dayClosedCheckbox = this.querySelector(`input[name="openingHours.${day}.closed"]`);
      const day24HoursCheckbox = this.querySelector(`input[name="openingHours.${day}.24hours"]`);
      
      if (dayOpenInput) dayOpenInput.value = openValue;
      if (dayCloseInput) dayCloseInput.value = closeValue;
      if (dayClosedCheckbox) dayClosedCheckbox.checked = closedValue;
      if (day24HoursCheckbox) day24HoursCheckbox.checked = is24HoursValue;
      
      this.toggleDayInputs(day);
    });

    Toast.show(`Copied ${sourceDay}'s hours to all days`, 'success', 2000);
  }

  clearAllHours() {
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
      const dayOpenInput = this.querySelector(`input[name="openingHours.${day}.open"]`);
      const dayCloseInput = this.querySelector(`input[name="openingHours.${day}.close"]`);
      const dayClosedCheckbox = this.querySelector(`input[name="openingHours.${day}.closed"]`);
      const day24HoursCheckbox = this.querySelector(`input[name="openingHours.${day}.24hours"]`);
      
      if (dayOpenInput) dayOpenInput.value = '';
      if (dayCloseInput) dayCloseInput.value = '';
      if (dayClosedCheckbox) dayClosedCheckbox.checked = false;
      if (day24HoursCheckbox) day24HoursCheckbox.checked = false;
      
      this.toggleDayInputs(day);
    });

    Toast.show('Cleared all opening hours', 'success', 2000);
  }

  setWeekdayHours() {
    const mondayOpen = this.querySelector('input[name="openingHours.monday.open"]');
    const mondayClose = this.querySelector('input[name="openingHours.monday.close"]');
    const mondayClosed = this.querySelector('input[name="openingHours.monday.closed"]');

    if (!mondayOpen || !mondayClose || !mondayClosed) return;

    const isMondayClosed = mondayClosed.checked;

    if (!isMondayClosed && (!mondayOpen.value || !mondayClose.value)) {
      Toast.show('Please set Monday hours first', 'error', 2000);
      return;
    }

    const openValue = mondayOpen.value;
    const closeValue = mondayClose.value;

    // Set weekdays (Monday-Friday)
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].forEach(day => {
      const dayOpenInput = this.querySelector(`input[name="openingHours.${day}.open"]`);
      const dayCloseInput = this.querySelector(`input[name="openingHours.${day}.close"]`);
      const dayClosedCheckbox = this.querySelector(`input[name="openingHours.${day}.closed"]`);
      const day24HoursCheckbox = this.querySelector(`input[name="openingHours.${day}.24hours"]`);
      
      if (dayOpenInput) dayOpenInput.value = openValue;
      if (dayCloseInput) dayCloseInput.value = closeValue;
      if (dayClosedCheckbox) dayClosedCheckbox.checked = isMondayClosed;
      if (day24HoursCheckbox) day24HoursCheckbox.checked = false;
      
      this.toggleDayInputs(day);
    });

    // Mark weekends as closed
    ['saturday', 'sunday'].forEach(day => {
      const dayOpenInput = this.querySelector(`input[name="openingHours.${day}.open"]`);
      const dayCloseInput = this.querySelector(`input[name="openingHours.${day}.close"]`);
      const dayClosedCheckbox = this.querySelector(`input[name="openingHours.${day}.closed"]`);
      const day24HoursCheckbox = this.querySelector(`input[name="openingHours.${day}.24hours"]`);
      
      if (dayOpenInput) dayOpenInput.value = '';
      if (dayCloseInput) dayCloseInput.value = '';
      if (dayClosedCheckbox) dayClosedCheckbox.checked = true;
      if (day24HoursCheckbox) day24HoursCheckbox.checked = false;
      
      this.toggleDayInputs(day);
    });

    Toast.show('Set weekday hours (Mon-Fri, weekends closed)', 'success', 2000);
  }

  validate() {
    const errors = [];
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
      const is24Hours = this.querySelector(`input[name="openingHours.${day}.24hours"]`)?.checked;
      const closed = this.querySelector(`input[name="openingHours.${day}.closed"]`)?.checked;
      
      if (closed || is24Hours) return;

      const open = this.querySelector(`input[name="openingHours.${day}.open"]`)?.value;
      const close = this.querySelector(`input[name="openingHours.${day}.close"]`)?.value;

      if ((open && !close) || (!open && close)) {
        errors.push({
          field: `openingHours.${day}.open`,
          message: `Both opening and closing times required for ${day.charAt(0).toUpperCase() + day.slice(1)}`
        });
      }
      
      if (open && close && open >= close) {
        errors.push({
          field: `openingHours.${day}.open`,
          message: `Opening time must be before closing time for ${day.charAt(0).toUpperCase() + day.slice(1)}`
        });
      }
    });
    return errors;
  }

  render() {
    const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const times = this.openingTimes || {};

    // Normalize times structure if it comes in as array or partial object
    const normalizedTimes = {};
    dayNames.forEach(day => {
      if (Array.isArray(times[day])) {
        const [open, close] = times[day];
        if (open === '00:00' && close === '00:00') {
          normalizedTimes[day] = { open: '', close: '', closed: false, is24Hours: true };
        } else if (open && close) {
          normalizedTimes[day] = { open, close, closed: false, is24Hours: false };
        } else {
          normalizedTimes[day] = { open: '', close: '', closed: true, is24Hours: false };
        }
      } else if (times[day]) {
        normalizedTimes[day] = times[day];
      } else {
        normalizedTimes[day] = { open: '', close: '', closed: false, is24Hours: false };
      }
    });

    this.innerHTML = `
      <div class="form-group">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-s);">
          <label class="form-label" style="margin-bottom: 0;">Opening Hours</label>
          <div class="button-group">
            <button type="button" id="btn-copy-mon" class="btn btn-sm btn-secondary">Copy Mon to All</button>
            <button type="button" id="btn-set-weekdays" class="btn btn-sm btn-secondary">Weekdays Only</button>
            <button type="button" id="btn-clear-hours" class="btn btn-sm btn-danger">Clear All</button>
          </div>
        </div>
        
        <div class="opening-hours-grid">
          ${dayNames.map(day => {
            const { open, close, closed, is24Hours } = normalizedTimes[day];
            const isDisabled = closed || is24Hours;
            
            return `
              <div class="form-row opening-hours-row" style="align-items: center; margin-bottom: var(--space-xs);">
                <div style="width: 100px; font-weight: 500; text-transform: capitalize;">${day}</div>
                <div style="display: flex; align-items: center; gap: var(--space-s); flex: 1;">
                  <div class="form-check">
                    <input type="checkbox" id="closed-${day}" name="openingHours.${day}.closed" class="form-check-input" ${closed ? 'checked' : ''}>
                    <label for="closed-${day}" class="form-check-label">Closed</label>
                  </div>
                  <div class="form-check">
                    <input type="checkbox" id="24h-${day}" name="openingHours.${day}.24hours" class="form-check-input" ${is24Hours ? 'checked' : ''}>
                    <label for="24h-${day}" class="form-check-label">24 Hours</label>
                  </div>
                  <input type="time" name="openingHours.${day}.open" class="form-control" value="${open || ''}" ${isDisabled ? 'disabled' : ''}>
                  <span>to</span>
                  <input type="time" name="openingHours.${day}.close" class="form-control" value="${close || ''}" ${isDisabled ? 'disabled' : ''}>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }
}

customElements.define('opening-hours-editor', OpeningHoursEditor);
