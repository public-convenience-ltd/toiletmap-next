import { apiService } from '../services/ApiService.js';
import { Toast } from '../utils/Toast.js';
import { eventBus } from '../utils/EventBus.js';
import { componentRegistry, getNextComponentId } from '../utils/registry.js';
import './ReportTimeline.js';

export class LooEditor extends HTMLElement {
  constructor() {
    super();
    this.componentId = getNextComponentId('editor');
    this.loo = null;
    this.loading = false;
    this.saving = false;
    this.isNew = true;
    this.showReports = false;
    this.originalLocation = null;
    this.mapPicker = null;
    this.originalFormData = null;
  }

  static get observedAttributes() {
    return ['loo-id'];
  }

  async connectedCallback() {
    componentRegistry.set(this.componentId, this);
    const looId = this.getAttribute('loo-id');
    this.isNew = !looId;
    this.render();

    if (looId) {
      await this.loadLoo(looId);
      // Capture initial form state for edit mode
      queueMicrotask(() => {
        this.captureFormData();
        this.updateChangesSummary();
      });
    }
  }

  setupPaymentDetailsToggle() {
    const noPaymentRadios = this.querySelectorAll('input[name="noPayment"]');
    const paymentDetailsGroup = this.querySelector('#payment-details-group');
    const paymentDetailsInput = this.querySelector('input[name="paymentDetails"]');

    if (noPaymentRadios.length && paymentDetailsGroup && paymentDetailsInput) {
      const updateVisibility = () => {
        const checkedRadio = this.querySelector('input[name="noPayment"]:checked');
        const isFree = checkedRadio?.value === 'true';
        paymentDetailsGroup.style.display = isFree ? 'none' : 'flex';
        paymentDetailsInput.required = !isFree;
        if (isFree) {
          paymentDetailsInput.value = '';
        }
      };

      noPaymentRadios.forEach(radio => {
        radio.addEventListener('change', updateVisibility);
      });
      updateVisibility(); // Initial state
    }
  }

  setupMapPicker() {
    const mapContainer = this.querySelector('#location-map-picker');
    if (!mapContainer || this.mapPicker) return;

    const lat = parseFloat(this.querySelector('input[name="lat"]')?.value) || 51.5074;
    const lng = parseFloat(this.querySelector('input[name="lng"]')?.value) || -0.1278;

    // Store original location for reset functionality
    if (!this.isNew && this.loo?.location) {
      this.originalLocation = {
        lat: this.loo.location.lat,
        lng: this.loo.location.lng
      };
    }

    this.mapPicker = L.map(mapContainer, {
      center: [lat, lng],
      zoom: 15,
      scrollWheelZoom: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.mapPicker);

    // Update coordinates on map move
    const updateCoordinates = () => {
      const center = this.mapPicker.getCenter();
      const latInput = this.querySelector('input[name="lat"]');
      const lngInput = this.querySelector('input[name="lng"]');
      const coordsDisplay = this.querySelector('#map-coords-display');

      if (latInput) latInput.value = center.lat.toFixed(6);
      if (lngInput) lngInput.value = center.lng.toFixed(6);
      if (coordsDisplay) {
        coordsDisplay.innerHTML = `<code>${center.lat.toFixed(6)}</code>, <code>${center.lng.toFixed(6)}</code>`;
      }

      // Update changes summary when coordinates change
      this.updateChangesSummary();
    };

    this.mapPicker.on('moveend', updateCoordinates);
    updateCoordinates();
  }

  resetMapLocation() {
    if (!this.mapPicker || !this.originalLocation) {
      Toast.show('No original location to reset to', 'error', 2000);
      return;
    }

    this.mapPicker.setView([this.originalLocation.lat, this.originalLocation.lng], 15);
    Toast.show('Map location reset to original', 'success', 2000);
  }

  getTriStateValue(fieldName) {
    const checked = this.querySelector(`input[name="${fieldName}"]:checked`);
    if (!checked) return null;
    if (checked.value === 'true') return true;
    if (checked.value === 'false') return false;
    return null;
  }

  validateForm(form) {
    // Clear previous errors
    this.querySelectorAll('.form-error').forEach(el => el.remove());
    this.querySelectorAll('.has-error').forEach(el => el.classList.remove('has-error'));

    const errors = [];

    // Validate name
    const name = form.elements['name']?.value?.trim();
    if (!name) {
      errors.push({ field: 'name', message: 'Name is required' });
    }

    // Validate location coordinates
    const lat = form.elements['lat']?.value;
    const lng = form.elements['lng']?.value;
    if (lat && !lng) {
      errors.push({ field: 'lng', message: 'Longitude is required when latitude is provided' });
    }
    if (lng && !lat) {
      errors.push({ field: 'lat', message: 'Latitude is required when longitude is provided' });
    }
    if (lat && (parseFloat(lat) < -90 || parseFloat(lat) > 90)) {
      errors.push({ field: 'lat', message: 'Latitude must be between -90 and 90' });
    }
    if (lng && (parseFloat(lng) < -180 || parseFloat(lng) > 180)) {
      errors.push({ field: 'lng', message: 'Longitude must be between -180 and 180' });
    }

    // Validate payment details if not free
    const noPaymentValue = this.getTriStateValue('noPayment');
    const paymentDetails = form.elements['paymentDetails']?.value?.trim();
    if (noPaymentValue === false && !paymentDetails) {
      errors.push({ field: 'paymentDetails', message: 'Payment details are required when not free' });
    }

    // Validate opening hours - ensure both open and close times are provided for each day
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
      const closed = form.elements[`openingHours.${day}.closed`]?.checked;
      if (closed) return; // Skip validation for closed days

      const open = form.elements[`openingHours.${day}.open`]?.value;
      const close = form.elements[`openingHours.${day}.close`]?.value;
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

    // Display errors
    errors.forEach(({ field, message }) => {
      const input = form.elements[field];
      if (input) {
        // Try to find form-group first, then form-row (for opening hours)
        const container = input.closest('.form-group') || input.closest('.form-row');
        if (container) {
          container.classList.add('has-error');
          const errorEl = document.createElement('div');
          errorEl.className = 'form-error';
          errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
          container.appendChild(errorEl);
        }
      }
    });

    return errors.length === 0;
  }

  copyHoursToAll(sourceDay) {
    const form = this.querySelector('form');
    const openInput = form.querySelector(`input[name="openingHours.${sourceDay}.open"]`);
    const closeInput = form.querySelector(`input[name="openingHours.${sourceDay}.close"]`);
    const closedCheckbox = form.querySelector(`input[name="openingHours.${sourceDay}.closed"]`);

    if (!openInput || !closeInput || !closedCheckbox) return;

    const openValue = openInput.value;
    const closeValue = closeInput.value;
    const closedValue = closedCheckbox.checked;

    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
      const dayOpenInput = form.querySelector(`input[name="openingHours.${day}.open"]`);
      const dayCloseInput = form.querySelector(`input[name="openingHours.${day}.close"]`);
      const dayClosedCheckbox = form.querySelector(`input[name="openingHours.${day}.closed"]`);
      if (dayOpenInput) dayOpenInput.value = openValue;
      if (dayCloseInput) dayCloseInput.value = closeValue;
      if (dayClosedCheckbox) {
        dayClosedCheckbox.checked = closedValue;
        this.toggleDayInputs(day);
      }
    });

    Toast.show(`Copied ${sourceDay}'s hours to all days`, 'success', 2000);
  }

  toggleDayInputs(day) {
    const form = this.querySelector('form');
    const closedCheckbox = form.querySelector(`input[name="openingHours.${day}.closed"]`);
    const openInput = form.querySelector(`input[name="openingHours.${day}.open"]`);
    const closeInput = form.querySelector(`input[name="openingHours.${day}.close"]`);

    if (closedCheckbox && openInput && closeInput) {
      const isClosed = closedCheckbox.checked;

      if (isClosed) {
        // Store current values before clearing
        if (openInput.value) openInput.dataset.savedValue = openInput.value;
        if (closeInput.value) closeInput.dataset.savedValue = closeInput.value;
        openInput.value = '';
        closeInput.value = '';
        openInput.disabled = true;
        closeInput.disabled = true;
      } else {
        // Restore saved values if they exist
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

  clearAllHours() {
    const form = this.querySelector('form');
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
      const dayOpenInput = form.querySelector(`input[name="openingHours.${day}.open"]`);
      const dayCloseInput = form.querySelector(`input[name="openingHours.${day}.close"]`);
      const dayClosedCheckbox = form.querySelector(`input[name="openingHours.${day}.closed"]`);
      if (dayOpenInput) dayOpenInput.value = '';
      if (dayCloseInput) dayCloseInput.value = '';
      if (dayClosedCheckbox) {
        dayClosedCheckbox.checked = false;
        this.toggleDayInputs(day);
      }
    });

    Toast.show('Cleared all opening hours', 'success', 2000);
  }

  setWeekdayHours() {
    const form = this.querySelector('form');
    const mondayOpen = form.querySelector('input[name="openingHours.monday.open"]');
    const mondayClose = form.querySelector('input[name="openingHours.monday.close"]');
    const mondayClosed = form.querySelector('input[name="openingHours.monday.closed"]');

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
      const dayOpenInput = form.querySelector(`input[name="openingHours.${day}.open"]`);
      const dayCloseInput = form.querySelector(`input[name="openingHours.${day}.close"]`);
      const dayClosedCheckbox = form.querySelector(`input[name="openingHours.${day}.closed"]`);
      if (dayOpenInput) dayOpenInput.value = openValue;
      if (dayCloseInput) dayCloseInput.value = closeValue;
      if (dayClosedCheckbox) {
        dayClosedCheckbox.checked = isMondayClosed;
        this.toggleDayInputs(day);
      }
    });

    // Mark weekends as closed
    ['saturday', 'sunday'].forEach(day => {
      const dayOpenInput = form.querySelector(`input[name="openingHours.${day}.open"]`);
      const dayCloseInput = form.querySelector(`input[name="openingHours.${day}.close"]`);
      const dayClosedCheckbox = form.querySelector(`input[name="openingHours.${day}.closed"]`);
      if (dayOpenInput) dayOpenInput.value = '';
      if (dayCloseInput) dayCloseInput.value = '';
      if (dayClosedCheckbox) {
        dayClosedCheckbox.checked = true;
        this.toggleDayInputs(day);
      }
    });

    Toast.show('Set weekday hours (Mon-Fri, weekends closed)', 'success', 2000);
  }

  disconnectedCallback() {
    componentRegistry.delete(this.componentId);
  }

  async loadLoo(id) {
    this.loading = true;
    this.render();

    try {
      this.loo = await apiService.getLoo(id);
      console.log('Loaded loo data:', this.loo);
      console.log('Opening times:', this.loo.openingTimes);
      this.loading = false;
      this.render();
    } catch (error) {
      console.error('Failed to load loo:', error);
      Toast.show(error.message || 'Failed to load loo', 'error');
      this.loading = false;
      this.render();
    }
  }

  async handleSubmit(e) {
    e.preventDefault();
    const form = e.target;

    // Validate form
    if (!this.validateForm(form)) {
      Toast.show('Please fix the validation errors', 'error', 3000);
      return;
    }

    const data = {
      name: form.elements['name']?.value || null,
      active: this.getTriStateValue('active'),
      accessible: this.getTriStateValue('accessible'),
      allGender: this.getTriStateValue('allGender'),
      attended: this.getTriStateValue('attended'),
      automatic: this.getTriStateValue('automatic'),
      babyChange: this.getTriStateValue('babyChange'),
      children: this.getTriStateValue('children'),
      men: this.getTriStateValue('men'),
      women: this.getTriStateValue('women'),
      radar: this.getTriStateValue('radar'),
      urinalOnly: this.getTriStateValue('urinalOnly'),
      noPayment: this.getTriStateValue('noPayment'),
      paymentDetails: form.elements['paymentDetails']?.value || null,
      notes: form.elements['notes']?.value || null,
      removalReason: form.elements['removalReason']?.value || null,
    };

    const lat = form.elements['lat']?.value;
    const lng = form.elements['lng']?.value;
    if (lat && lng) {
      data.location = {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
      };
    }

    // Collect opening hours and convert to array format
    // Array has 7 elements: Monday (0) through Sunday (6)
    // Each element is either ["HH:mm", "HH:mm"] (open) or [] (closed)
    const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const openingTimesArray = [];
    let hasAnyOpeningTimes = false;

    dayNames.forEach(day => {
      const closed = form.elements[`openingHours.${day}.closed`]?.checked;
      const open = form.elements[`openingHours.${day}.open`]?.value;
      const close = form.elements[`openingHours.${day}.close`]?.value;

      if (closed) {
        openingTimesArray.push([]);
      } else if (open && close) {
        openingTimesArray.push([open, close]);
        hasAnyOpeningTimes = true;
      } else {
        // Unknown opening hours for this day
        openingTimesArray.push([]);
      }
    });

    // If all days are unknown (all empty arrays and no times set), send null
    if (hasAnyOpeningTimes) {
      data.openingTimes = openingTimesArray;
      console.log('Opening times array:', openingTimesArray);
    } else {
      data.openingTimes = null;
      console.log('Opening times set to null (all unknown)');
    }

    this.saving = true;
    this.render();

    try {
      if (this.isNew) {
        await apiService.createLoo(data);
        Toast.show('Loo created successfully!', 'success');
        this.backToList();
      } else {
        await apiService.updateLoo(this.loo.id, data);
        Toast.show('Loo updated successfully!', 'success');
        this.backToList();
      }
      this.saving = false;
    } catch (error) {
      console.error('Failed to save loo:', error);
      Toast.show(error.message || 'Failed to save loo', 'error');
      this.saving = false;
      this.render();
    }
  }

  backToList() {
    eventBus.emit('view-changed', { view: 'list' });
  }

  toggleReports() {
    this.showReports = !this.showReports;
    this.render();
  }

  captureFormData() {
    const form = this.querySelector('form');
    if (!form) return;

    const formData = new FormData(form);
    const data = {};

    // Capture all form values
    for (const [key, value] of formData.entries()) {
      data[key] = value;
    }

    // Capture radio button states
    form.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
      data[radio.name] = radio.value;
    });

    // Capture checkbox states for opening hours
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
      const checkbox = form.querySelector(`input[name="openingHours.${day}.closed"]`);
      if (checkbox) {
        data[`openingHours.${day}.closed`] = checkbox.checked;
      }
    });

    this.originalFormData = data;
  }

  resetForm() {
    if (!this.originalFormData) {
      Toast.show('No original data to reset to', 'error', 2000);
      return;
    }

    const form = this.querySelector('form');
    if (!form) return;

    // Reset all text inputs and textareas
    Object.keys(this.originalFormData).forEach(key => {
      const element = form.elements[key];
      if (element) {
        if (element.type === 'radio') {
          const radio = form.querySelector(`input[name="${key}"][value="${this.originalFormData[key]}"]`);
          if (radio) radio.checked = true;
        } else if (element.type === 'checkbox') {
          element.checked = this.originalFormData[key];
        } else {
          element.value = this.originalFormData[key] || '';
        }
      }
    });

    // Reset opening hours closed states
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
      const checkbox = form.querySelector(`input[name="openingHours.${day}.closed"]`);
      if (checkbox && this.originalFormData[`openingHours.${day}.closed`] !== undefined) {
        checkbox.checked = this.originalFormData[`openingHours.${day}.closed`];
        this.toggleDayInputs(day);
      }
    });

    // Reset map if needed
    if (this.mapPicker && this.originalLocation) {
      this.mapPicker.setView([this.originalLocation.lat, this.originalLocation.lng], 15);
    }

    Toast.show('Form reset to original values', 'success', 2000);
    this.render();
  }

  setupFormChangeListeners() {
    const form = this.querySelector('form');
    if (!form) return;

    // Listen for any input changes to update the summary
    form.addEventListener('input', () => {
      this.updateChangesSummary();
    });

    form.addEventListener('change', () => {
      this.updateChangesSummary();
    });
  }

  updateChangesSummary() {
    if (this.isNew) return;

    const changesList = this.querySelector('#changes-list');
    if (!changesList) return;

    const changes = this.getChanges();

    if (changes.length === 0) {
      changesList.innerHTML = `
        <div style="color: var(--color-text-secondary); font-size: var(--text--1); font-style: italic;">
          No changes made
        </div>
      `;
    } else {
      changesList.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: var(--space-xs);">
          ${changes.map(change => `
            <div style="display: grid; grid-template-columns: 150px 1fr; gap: var(--space-s); padding: var(--space-xs); background: white; border-radius: var(--radius-sm); font-size: var(--text--1); border-left: 3px solid var(--color-blue);">
              <strong style="color: var(--color-blue);">${change.field}:</strong>
              <div>
                <span style="color: var(--color-danger); text-decoration: line-through;">${this.escapeHtml(change.from)}</span>
                <i class="fas fa-arrow-right" style="margin: 0 var(--space-2xs); color: var(--color-text-secondary);"></i>
                <span style="color: var(--color-success); font-weight: 600;">${this.escapeHtml(change.to)}</span>
              </div>
            </div>
          `).join('')}
        </div>
      `;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getChanges() {
    if (!this.originalFormData) return [];

    const form = this.querySelector('form');
    if (!form) return [];

    const changes = [];
    const currentFormData = new FormData(form);

    // Check tri-state fields
    const triStateFields = ['accessible', 'active', 'allGender', 'attended', 'automatic',
                            'babyChange', 'children', 'men', 'women', 'radar',
                            'urinalOnly', 'noPayment'];

    triStateFields.forEach(field => {
      const checkedRadio = form.querySelector(`input[name="${field}"]:checked`);
      const currentValue = checkedRadio?.value || 'null';
      const originalValue = this.originalFormData[field] || 'null';

      if (currentValue !== originalValue) {
        const formatValue = (val) => {
          if (val === 'true') return 'Yes';
          if (val === 'false') return 'No';
          return 'Unknown';
        };
        changes.push({
          field: field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
          from: formatValue(originalValue),
          to: formatValue(currentValue),
        });
      }
    });

    // Check text fields
    const textFields = ['name', 'notes', 'paymentDetails', 'removalReason'];
    textFields.forEach(field => {
      const element = form.elements[field];
      if (element) {
        const currentValue = element.value || '';
        const originalValue = this.originalFormData[field] || '';
        if (currentValue !== originalValue) {
          changes.push({
            field: field.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()),
            from: originalValue || '(empty)',
            to: currentValue || '(empty)',
          });
        }
      }
    });

    // Check location
    const latElement = form.elements['lat'];
    const lngElement = form.elements['lng'];
    if (latElement && lngElement) {
      const currentLat = latElement.value;
      const currentLng = lngElement.value;
      const originalLat = this.originalFormData['lat'] || '';
      const originalLng = this.originalFormData['lng'] || '';

      if (currentLat !== originalLat || currentLng !== originalLng) {
        changes.push({
          field: 'Location',
          from: originalLat && originalLng ? `${originalLat}, ${originalLng}` : '(not set)',
          to: currentLat && currentLng ? `${currentLat}, ${currentLng}` : '(not set)',
        });
      }
    }

    // Check opening hours
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    dayNames.forEach((dayName, index) => {
      const dayLower = dayName.toLowerCase();
      const openElement = form.elements[`openingHours.${dayLower}.open`];
      const closeElement = form.elements[`openingHours.${dayLower}.close`];
      const closedCheckbox = form.querySelector(`input[name="openingHours.${dayLower}.closed"]`);

      const currentOpen = openElement?.value || '';
      const currentClose = closeElement?.value || '';
      const currentClosed = closedCheckbox?.checked || false;

      const originalOpen = this.originalFormData[`openingHours.${dayLower}.open`] || '';
      const originalClose = this.originalFormData[`openingHours.${dayLower}.close`] || '';
      const originalClosed = this.originalFormData[`openingHours.${dayLower}.closed`] || false;

      if (currentOpen !== originalOpen || currentClose !== originalClose || currentClosed !== originalClosed) {
        const formatHours = (open, close, closed) => {
          if (closed) return 'Closed';
          if (open && close) return `${open} - ${close}`;
          return 'Unknown';
        };

        changes.push({
          field: `${dayName} Hours`,
          from: formatHours(originalOpen, originalClose, originalClosed),
          to: formatHours(currentOpen, currentClose, currentClosed),
        });
      }
    });

    return changes;
  }

  render() {
    if (this.loading) {
      this.innerHTML = `
        <div style="text-align: center; padding: 3rem;">
          <div class="loading" style="width: 2rem; height: 2rem;"></div>
        </div>
      `;
      return;
    }

    const loo = this.loo || {};

    // Helper function to parse opening times from array format
    // Array has 7 elements: Monday (0) through Sunday (6)
    // Each element is either ["HH:mm", "HH:mm"] (open) or [] (closed)
    const parseOpeningTimes = () => {
      const times = {};
      const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

      if (Array.isArray(loo.openingTimes)) {
        loo.openingTimes.forEach((dayData, index) => {
          const dayName = dayNames[index];
          if (Array.isArray(dayData) && dayData.length === 2) {
            times[dayName] = { open: dayData[0], close: dayData[1], closed: false };
          } else {
            times[dayName] = { open: '', close: '', closed: true };
          }
        });
      } else {
        // Initialize with empty values if no opening times
        dayNames.forEach(day => {
          times[day] = { open: '', close: '', closed: false };
        });
      }

      console.log('Parsed opening times for display:', times);
      return times;
    };

    const openingTimes = parseOpeningTimes();

    // Helper function to create tri-state control
    const createTriState = (name, value) => {
      const idPrefix = `${this.componentId}-${name}`;
      return `
        <div class="tri-state">
          <input type="radio" id="${idPrefix}-yes" name="${name}" value="true" ${value === true ? 'checked' : ''}>
          <label for="${idPrefix}-yes">Yes</label>

          <input type="radio" id="${idPrefix}-no" name="${name}" value="false" ${value === false ? 'checked' : ''}>
          <label for="${idPrefix}-no">No</label>

          <input type="radio" id="${idPrefix}-unknown" name="${name}" value="null" ${value === null || value === undefined ? 'checked' : ''}>
          <label for="${idPrefix}-unknown">Unknown</label>
        </div>
      `;
    };

    this.innerHTML = `
      <div style="max-width: 900px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-l);">
          <div style="display: flex; align-items: center; gap: var(--space-s);">
            <button class="btn-secondary" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').backToList())">
              <i class="fas fa-arrow-left"></i> Back
            </button>
            <h1 style="font-size: var(--text-3); color: var(--color-blue);">${this.isNew ? 'Add New Loo' : 'Edit Loo'}</h1>
          </div>
          ${!this.isNew ? `
            <button class="btn-secondary" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').toggleReports())">
              <i class="fas fa-${this.showReports ? 'eye-slash' : 'eye'}"></i>
              ${this.showReports ? 'Hide' : 'Show'} History
            </button>
          ` : ''}
        </div>

        <div style="display: grid; gap: var(--space-l); grid-template-columns: ${this.showReports && !this.isNew ? '1fr 400px' : '1fr'};">
          <div style="background: white; border-radius: var(--radius-lg); padding: var(--space-l); box-shadow: var(--shadow-sm);">
            <form onsubmit="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').handleSubmit(event)); return false;">
              <div style="display: grid; gap: var(--space-m);">
                <div class="form-group">
                  <label>
                    <i class="fas fa-heading"></i>
                    Name
                  </label>
                  <input type="text" name="name" value="${loo.name || ''}" placeholder="Enter loo name" required>
                </div>

                <div class="form-section">
                  <h3>
                    <i class="fas fa-location-dot"></i>
                    Location
                  </h3>
                  <div style="margin-bottom: var(--space-s);">
                    <div class="map-picker">
                      <div id="location-map-picker" style="width: 100%; height: 100%;"></div>
                      <div class="map-picker-crosshair">
                        <i class="fas fa-crosshairs"></i>
                      </div>
                      <div class="map-picker-info">
                        <div class="map-picker-coords" id="map-coords-display">
                          <code>${loo.location?.lat?.toFixed(6) || '51.507400'}</code>, <code>${loo.location?.lng?.toFixed(6) || '-0.127800'}</code>
                        </div>
                        <div style="font-size: var(--text--2); color: var(--color-text-secondary); margin-top: 4px;">
                          Pan the map to set the location
                        </div>
                      </div>
                    </div>
                    ${!this.isNew && this.loo?.location ? `
                      <button
                        type="button"
                        class="btn-sm btn-secondary"
                        onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').resetMapLocation())"
                        style="margin-top: var(--space-xs);"
                      >
                        <i class="fas fa-undo"></i> Reset to Original Location
                      </button>
                    ` : ''}
                  </div>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-s);">
                    <div class="form-group">
                      <label>Latitude</label>
                      <input
                        type="number"
                        step="any"
                        name="lat"
                        value="${loo.location?.lat || ''}"
                        placeholder="51.5074"
                        readonly
                        style="background: var(--color-bg-secondary);"
                      >
                    </div>
                    <div class="form-group">
                      <label>Longitude</label>
                      <input
                        type="number"
                        step="any"
                        name="lng"
                        value="${loo.location?.lng || ''}"
                        placeholder="-0.1278"
                        readonly
                        style="background: var(--color-bg-secondary);"
                      >
                    </div>
                  </div>
                </div>

                <div class="form-section">
                  <h3>Status</h3>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-check-circle" style="width: 1.25rem;"></i>
                      Active
                    </label>
                    ${createTriState('active', loo.active)}
                  </div>
                </div>

                <div class="form-section">
                  <h3>Accessibility</h3>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-wheelchair" style="width: 1.25rem;"></i>
                      Accessible
                    </label>
                    ${createTriState('accessible', loo.accessible)}
                  </div>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-key" style="width: 1.25rem;"></i>
                      RADAR Key
                    </label>
                    ${createTriState('radar', loo.radar)}
                  </div>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-baby" style="width: 1.25rem;"></i>
                      Baby Change
                    </label>
                    ${createTriState('babyChange', loo.babyChange)}
                  </div>
                </div>

                <div class="form-section">
                  <h3>Gender Facilities</h3>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-person" style="width: 1.25rem;"></i>
                      Men
                    </label>
                    ${createTriState('men', loo.men)}
                  </div>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-person-dress" style="width: 1.25rem;"></i>
                      Women
                    </label>
                    ${createTriState('women', loo.women)}
                  </div>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-restroom" style="width: 1.25rem;"></i>
                      All Gender
                    </label>
                    ${createTriState('allGender', loo.allGender)}
                  </div>
                </div>

                <div class="form-section">
                  <h3>Additional Features</h3>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-user-tie" style="width: 1.25rem;"></i>
                      Attended
                    </label>
                    ${createTriState('attended', loo.attended)}
                  </div>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-robot" style="width: 1.25rem;"></i>
                      Automatic
                    </label>
                    ${createTriState('automatic', loo.automatic)}
                  </div>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-child" style="width: 1.25rem;"></i>
                      Children
                    </label>
                    ${createTriState('children', loo.children)}
                  </div>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-toilet" style="width: 1.25rem;"></i>
                      Urinal Only
                    </label>
                    ${createTriState('urinalOnly', loo.urinalOnly)}
                  </div>
                  <div class="form-row">
                    <label>
                      <i class="fas fa-coins" style="width: 1.25rem;"></i>
                      Free (No Payment)
                    </label>
                    ${createTriState('noPayment', loo.noPayment)}
                  </div>
                </div>

                <div class="form-group" id="payment-details-group" style="display: ${loo.noPayment === false ? 'flex' : 'none'};">
                  <label>
                    <i class="fas fa-credit-card"></i>
                    Payment Details <span style="color: var(--color-danger);">*</span>
                  </label>
                  <input type="text" name="paymentDetails" value="${loo.paymentDetails || ''}" placeholder="e.g., 20p coin required" ${loo.noPayment === false ? 'required' : ''}>
                </div>

                <div class="form-section">
                  <h3>Opening Hours</h3>
                  <div style="font-size: var(--text--1); color: var(--color-text-secondary); margin-bottom: var(--space-s);">
                    Set opening hours for each day or mark as closed. If all times are unknown, leave everything blank.
                  </div>
                  ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day, index) => {
                    const dayLower = day.toLowerCase();
                    const hours = openingTimes[dayLower] || { open: '', close: '', closed: false };
                    const openValue = hours.open || '';
                    const closeValue = hours.close || '';
                    const isClosed = hours.closed || false;
                    return `
                      <div class="form-row" style="display: grid; grid-template-columns: 100px 1fr; gap: var(--space-s); align-items: center; margin-bottom: var(--space-xs);">
                        <label style="margin: 0; font-weight: 600;">${day}</label>
                        <div style="display: grid; grid-template-columns: 1fr 1fr auto auto; gap: var(--space-xs); align-items: center;">
                          <input
                            type="time"
                            name="openingHours.${dayLower}.open"
                            value="${openValue}"
                            placeholder="Open"
                            ${isClosed ? 'disabled' : ''}
                            style="padding: var(--space-2xs); font-size: var(--text--1);"
                          >
                          <input
                            type="time"
                            name="openingHours.${dayLower}.close"
                            value="${closeValue}"
                            placeholder="Close"
                            ${isClosed ? 'disabled' : ''}
                            style="padding: var(--space-2xs); font-size: var(--text--1);"
                          >
                          <label style="display: flex; align-items: center; gap: var(--space-3xs); margin: 0; font-weight: normal; white-space: nowrap;">
                            <input
                              type="checkbox"
                              name="openingHours.${dayLower}.closed"
                              ${isClosed ? 'checked' : ''}
                              onchange="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').toggleDayInputs('${dayLower}'))"
                              style="width: auto; margin: 0;"
                            >
                            <span style="font-size: var(--text--1);">Closed</span>
                          </label>
                          <button
                            type="button"
                            class="btn-sm btn-secondary"
                            onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').copyHoursToAll('${dayLower}'))"
                            title="Copy to all days"
                            style="white-space: nowrap; padding: var(--space-3xs) var(--space-2xs);"
                          >
                            <i class="fas fa-copy"></i>
                          </button>
                        </div>
                      </div>
                    `;
                  }).join('')}
                  <div style="margin-top: var(--space-xs); display: flex; gap: var(--space-xs);">
                    <button
                      type="button"
                      class="btn-sm btn-secondary"
                      onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').clearAllHours())"
                    >
                      <i class="fas fa-eraser"></i> Clear All
                    </button>
                    <button
                      type="button"
                      class="btn-sm btn-secondary"
                      onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').setWeekdayHours())"
                    >
                      <i class="fas fa-business-time"></i> Set Weekdays Only
                    </button>
                  </div>
                </div>

                <div class="form-group">
                  <label>
                    <i class="fas fa-note-sticky"></i>
                    Notes
                  </label>
                  <textarea name="notes" rows="4" placeholder="Additional notes...">${loo.notes || ''}</textarea>
                </div>

                <div class="form-group">
                  <label>
                    <i class="fas fa-circle-info"></i>
                    Removal Reason
                  </label>
                  <input type="text" name="removalReason" value="${loo.removalReason || ''}" placeholder="Reason if marked inactive">
                </div>

                ${!this.isNew ? `
                  <div id="changes-summary" style="margin-top: var(--space-m); padding: var(--space-m); background: var(--color-bg-secondary); border-radius: var(--radius-md); border: 2px solid var(--color-border);">
                    <h4 style="margin: 0 0 var(--space-s) 0; font-size: var(--text-0); color: var(--color-blue); display: flex; align-items: center; gap: var(--space-xs);">
                      <i class="fas fa-list-check"></i>
                      Changes Summary
                    </h4>
                    <div id="changes-list"></div>
                  </div>
                ` : ''}

                <div style="display: flex; gap: var(--space-s); justify-content: flex-end; padding-top: var(--space-m); border-top: 2px solid var(--color-border);">
                  <button type="button" class="btn-secondary" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').backToList())">
                    <i class="fas fa-arrow-left"></i> Cancel
                  </button>
                  ${!this.isNew ? `
                    <button type="button" class="btn-secondary" onclick="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').resetForm())">
                      <i class="fas fa-undo"></i> Reset
                    </button>
                  ` : ''}
                  <button type="submit" class="btn-primary" ${this.saving ? 'disabled' : ''}>
                    ${this.saving ? '<i class="fas fa-spinner fa-spin"></i> Saving...' : (this.isNew ? '<i class="fas fa-plus"></i> Create Loo' : '<i class="fas fa-save"></i> Save Changes')}
                  </button>
                </div>
              </div>
            </form>
          </div>

          ${this.showReports && !this.isNew ? `
            <report-timeline loo-id="${this.loo.id}"></report-timeline>
          ` : ''}
        </div>
      </div>
    `;

    // Setup interactive components after DOM update
    queueMicrotask(() => {
      this.setupPaymentDetailsToggle();
      this.setupMapPicker();
      this.setupFormChangeListeners();
    });
  }
}

customElements.define('loo-editor', LooEditor);
