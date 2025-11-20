import { Toast } from '../utils/Toast.js';

export class LooMapPicker extends HTMLElement {
  constructor() {
    super();
    this.map = null;
    this.marker = null;
    this.originalLocation = null;
  }

  connectedCallback() {
    this.render();
    // Initialize map after render
    requestAnimationFrame(() => {
      this.initMap();
    });
  }

  set location(loc) {
    this._location = loc;
    if (this.map) {
      this.updateMap(loc);
    }
  }

  get location() {
    const latInput = this.querySelector('input[name="lat"]');
    const lngInput = this.querySelector('input[name="lng"]');
    return {
      lat: parseFloat(latInput?.value) || 0,
      lng: parseFloat(lngInput?.value) || 0
    };
  }

  set original(loc) {
    this.originalLocation = loc;
  }

  initMap() {
    const mapContainer = this.querySelector('#map-container');
    if (!mapContainer || this.map) return;

    const lat = this._location?.lat || 51.5074;
    const lng = this._location?.lng || -0.1278;

    this.map = L.map(mapContainer, {
      center: [lat, lng],
      zoom: 15,
      scrollWheelZoom: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(this.map);

    // Add center marker
    const updateMarker = () => {
      const center = this.map.getCenter();
      if (!this.marker) {
        this.marker = L.marker(center, { draggable: false }).addTo(this.map);
      } else {
        this.marker.setLatLng(center);
      }
      this.updateInputs(center);
    };

    this.map.on('move', updateMarker);
    this.map.on('moveend', () => {
      updateMarker();
      this.dispatchEvent(new CustomEvent('location-change', { 
        detail: this.map.getCenter(),
        bubbles: true 
      }));
    });

    // Initial marker
    updateMarker();

    // Input listeners
    const latInput = this.querySelector('input[name="lat"]');
    const lngInput = this.querySelector('input[name="lng"]');

    const updateMapFromInputs = () => {
      const newLat = parseFloat(latInput?.value);
      const newLng = parseFloat(lngInput?.value);
      if (!isNaN(newLat) && !isNaN(newLng) && this.map) {
        this.map.setView([newLat, newLng], this.map.getZoom());
      }
    };

    latInput?.addEventListener('change', updateMapFromInputs);
    lngInput?.addEventListener('change', updateMapFromInputs);

    // Reset button
    this.querySelector('#btn-reset-location')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.resetLocation();
    });
  }

  updateMap(loc) {
    if (!this.map || !loc) return;
    this.map.setView([loc.lat, loc.lng], this.map.getZoom());
  }

  updateInputs(center) {
    const latInput = this.querySelector('input[name="lat"]');
    const lngInput = this.querySelector('input[name="lng"]');
    const coordsDisplay = this.querySelector('#map-coords-display');

    if (latInput) latInput.value = center.lat.toFixed(6);
    if (lngInput) lngInput.value = center.lng.toFixed(6);
    if (coordsDisplay) {
      coordsDisplay.innerHTML = `<code>${center.lat.toFixed(6)}</code>, <code>${center.lng.toFixed(6)}</code>`;
    }
  }

  resetLocation() {
    if (!this.map || !this.originalLocation) {
      Toast.show('No original location to reset to', 'error', 2000);
      return;
    }

    this.map.setView([this.originalLocation.lat, this.originalLocation.lng], 15);
    Toast.show('Map location reset to original', 'success', 2000);
  }

  render() {
    const lat = this._location?.lat || '';
    const lng = this._location?.lng || '';

    this.innerHTML = `
      <div class="form-group">
        <label class="form-label">Location</label>
        <div class="form-row">
          <div class="form-group col-md-6">
            <label class="form-label text-sm">Latitude</label>
            <input type="number" step="any" name="lat" class="form-control" value="${lat}" required>
          </div>
          <div class="form-group col-md-6">
            <label class="form-label text-sm">Longitude</label>
            <input type="number" step="any" name="lng" class="form-control" value="${lng}" required>
          </div>
        </div>
        
        <div style="position: relative; height: 400px; margin-top: var(--space-xs); border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--color-border);">
          <div id="map-container" style="height: 100%; width: 100%; z-index: 1;"></div>
          <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000; pointer-events: none;">
            <i class="fas fa-crosshairs fa-2x" style="color: var(--color-primary); text-shadow: 0 2px 4px rgba(0,0,0,0.2);"></i>
          </div>
          <div style="position: absolute; bottom: var(--space-xs); left: var(--space-xs); z-index: 1000; background: rgba(255,255,255,0.9); padding: var(--space-2xs) var(--space-xs); border-radius: var(--radius-sm); font-size: var(--text--1); box-shadow: var(--shadow-sm);">
            <span id="map-coords-display"></span>
          </div>
          <button type="button" id="btn-reset-location" class="btn btn-sm btn-white" style="position: absolute; top: var(--space-xs); right: var(--space-xs); z-index: 1000; box-shadow: var(--shadow-sm);">
            <i class="fas fa-undo"></i> Reset
          </button>
        </div>
        <div class="form-text">Drag the map to position the crosshairs on the toilet location.</div>
      </div>
    `;
  }
}

customElements.define('loo-map-picker', LooMapPicker);
