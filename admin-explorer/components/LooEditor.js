import { apiService } from '../services/ApiService.js';
import { Toast } from '../utils/Toast.js';
import { eventBus } from '../utils/EventBus.js';
import { componentRegistry, getNextComponentId } from '../utils/registry.js';
import './ReportTimeline.js';
import './OpeningHoursEditor.js';
import './LooMapPicker.js';

export class LooEditor extends HTMLElement {
  constructor() {
    super();
    this.componentId = getNextComponentId('editor');
    this.loo = null;
    this.loading = false;
    this.saving = false;
    this.isNew = true;
    this.showReports = false;
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
    const mapPicker = this.querySelector('loo-map-picker');
    const { lat, lng } = mapPicker ? mapPicker.location : { lat: null, lng: null };
    
    if (lat && !lng) {
      errors.push({ field: 'lng', message: 'Longitude is required when latitude is provided' });
    }
    if (lng && !lat) {
      errors.push({ field: 'lat', message: 'Latitude is required when longitude is provided' });
    }
    if (lat && (lat < -90 || lat > 90)) {
      errors.push({ field: 'lat', message: 'Latitude must be between -90 and 90' });
    }
    if (lng && (lng < -180 || lng > 180)) {
      errors.push({ field: 'lng', message: 'Longitude must be between -180 and 180' });
    }

    // Validate payment details if not free
    const noPaymentValue = this.getTriStateValue('noPayment');
    const paymentDetails = form.elements['paymentDetails']?.value?.trim();
    if (noPaymentValue === false && !paymentDetails) {
      errors.push({ field: 'paymentDetails', message: 'Payment details are required when not free' });
    }

    // Validate opening hours
    const openingHoursEditor = this.querySelector('opening-hours-editor');
    if (openingHoursEditor) {
        const openingHoursErrors = openingHoursEditor.validate();
        errors.push(...openingHoursErrors);
    }

    // Display errors
    errors.forEach(({ field, message }) => {
      let input = form.elements[field];
      if (!input && (field === 'lat' || field === 'lng')) {
          input = this.querySelector(`input[name="${field}"]`);
      }

      if (input) {
        const container = input.closest('.form-group') || input.closest('.form-row');
        if (container) {
          container.classList.add('has-error');
          const errorEl = document.createElement('div');
          errorEl.className = 'form-error';
          errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
          container.appendChild(errorEl);
        }
      } else if (field.startsWith('openingHours')) {
          const container = this.querySelector('opening-hours-editor');
           if (container) {
              const errorEl = document.createElement('div');
              errorEl.className = 'form-error';
              errorEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
              container.appendChild(errorEl);
           }
      }
    });

    return errors.length === 0;
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

    const mapPicker = this.querySelector('loo-map-picker');
    if (mapPicker) {
        const { lat, lng } = mapPicker.location;
        if (lat && lng) {
            data.location = { lat, lng };
        }
    }

    const openingHoursEditor = this.querySelector('opening-hours-editor');
    if (openingHoursEditor) {
        const times = openingHoursEditor.value;
        const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const openingTimesArray = [];
        let hasAnyOpeningTimes = false;

        dayNames.forEach(day => {
            const time = times[day];
            if (Array.isArray(time) && time.length > 0) {
                openingTimesArray.push(time);
                hasAnyOpeningTimes = true;
            } else {
                openingTimesArray.push([]);
            }
        });

        if (hasAnyOpeningTimes) {
            data.openingTimes = openingTimesArray;
        } else {
            data.openingTimes = null;
        }
    }

    this.saving = true;
    this.render();

    try {
      if (this.isNew) {
        await apiService.createLoo(data);
        Toast.show('Loo created successfully!', 'success');
        setTimeout(() => this.backToList(), 100);
      } else {
        await apiService.updateLoo(this.loo.id, data);
        Toast.show('Loo updated successfully!', 'success');
        setTimeout(() => this.backToList(), 100);
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

    for (const [key, value] of formData.entries()) {
      data[key] = value;
    }

    form.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
      data[radio.name] = radio.value;
    });

    const mapPicker = this.querySelector('loo-map-picker');
    if (mapPicker) {
        const { lat, lng } = mapPicker.location;
        data.lat = lat;
        data.lng = lng;
    }

    const openingHoursEditor = this.querySelector('opening-hours-editor');
    if (openingHoursEditor) {
        data.openingTimes = openingHoursEditor.value;
    }

    this.originalFormData = data;
  }

  resetForm() {
    if (!this.originalFormData || !this.loo) {
      Toast.show('No original data to reset to', 'error', 2000);
      return;
    }

    const form = this.querySelector('form');
    if (!form) return;

    const loo = this.loo;

    if (form.elements['name']) form.elements['name'].value = loo.name || '';
    if (form.elements['notes']) form.elements['notes'].value = loo.notes || '';
    if (form.elements['paymentDetails']) form.elements['paymentDetails'].value = loo.paymentDetails || '';
    if (form.elements['removalReason']) form.elements['removalReason'].value = loo.removalReason || '';

    const mapPicker = this.querySelector('loo-map-picker');
    if (mapPicker && loo.location) {
        mapPicker.location = loo.location;
    }

    const triStateFields = ['active', 'accessible', 'allGender', 'attended', 'automatic',
                            'babyChange', 'children', 'men', 'women', 'radar',
                            'urinalOnly', 'noPayment'];

    triStateFields.forEach(field => {
      const value = loo[field];
      const radioValue = value === true ? 'true' : value === false ? 'false' : 'null';
      const radio = form.querySelector(`input[name="${field}"][value="${radioValue}"]`);
      if (radio) radio.checked = true;
    });

    const openingHoursEditor = this.querySelector('opening-hours-editor');
    if (openingHoursEditor && loo.openingTimes) {
        const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const times = {};
        loo.openingTimes.forEach((dayData, index) => {
            times[dayNames[index]] = dayData;
        });
        openingHoursEditor.value = times;
    }

    this.updateChangesSummary();
    Toast.show('Form reset to original values', 'success', 2000);
  }

  setupFormChangeListeners() {
    const form = this.querySelector('form');
    if (!form) return;

    form.addEventListener('input', () => {
      this.updateChangesSummary();
    });

    form.addEventListener('change', () => {
      this.updateChangesSummary();
    });
    
    this.addEventListener('location-change', () => this.updateChangesSummary());
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

    const mapPicker = this.querySelector('loo-map-picker');
    if (mapPicker) {
        const { lat, lng } = mapPicker.location;
        const originalLat = this.originalFormData['lat'];
        const originalLng = this.originalFormData['lng'];
        
        if (lat != originalLat || lng != originalLng) {
             changes.push({
                field: 'Location',
                from: originalLat && originalLng ? `${originalLat}, ${originalLng}` : '(not set)',
                to: lat && lng ? `${lat}, ${lng}` : '(not set)',
             });
        }
    }

    const openingHoursEditor = this.querySelector('opening-hours-editor');
    if (openingHoursEditor) {
        const currentTimes = openingHoursEditor.value;
        const originalTimes = this.originalFormData.openingTimes || {};
        
        ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
            const current = currentTimes[day] || [];
            const original = originalTimes[day] || [];
            
            const currentStr = JSON.stringify(current);
            const originalStr = JSON.stringify(original);
            
            if (currentStr !== originalStr) {
                const formatHours = (arr) => {
                    if (!arr || arr.length === 0) return 'Closed/Unknown';
                    if (arr[0] === '00:00' && arr[1] === '00:00') return '24 Hours';
                    return `${arr[0]} - ${arr[1]}`;
                };
                
                changes.push({
                    field: `${day.charAt(0).toUpperCase() + day.slice(1)} Hours`,
                    from: formatHours(original),
                    to: formatHours(current)
                });
            }
        });
    }

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

    const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const openingTimes = {};
    if (Array.isArray(loo.openingTimes)) {
        loo.openingTimes.forEach((dayData, index) => {
            openingTimes[dayNames[index]] = dayData;
        });
    }

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
            <form novalidate onsubmit="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').handleSubmit(event)); return false;">
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
                  <loo-map-picker></loo-map-picker>
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
                  <opening-hours-editor></opening-hours-editor>
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

    queueMicrotask(() => {
      this.setupPaymentDetailsToggle();
      this.setupFormChangeListeners();
      
      const mapPicker = this.querySelector('loo-map-picker');
      if (mapPicker) {
          if (loo.location) {
              mapPicker.location = loo.location;
              mapPicker.original = loo.location;
          } else {
              mapPicker.location = { lat: 51.5074, lng: -0.1278 };
          }
      }
      
      const openingHoursEditor = this.querySelector('opening-hours-editor');
      if (openingHoursEditor && openingTimes) {
          openingHoursEditor.value = openingTimes;
      }
    });
  }
}

customElements.define('loo-editor', LooEditor);
