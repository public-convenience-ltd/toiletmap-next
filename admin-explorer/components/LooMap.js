import { apiService } from '../services/ApiService.js';
import { eventBus } from '../utils/EventBus.js';
import { componentRegistry, getNextComponentId } from '../utils/registry.js';

export class LooMap extends HTMLElement {
  constructor() {
    super();
    this.componentId = getNextComponentId('map');
    this.map = null;
    this.markerClusterGroup = null;
    this.loos = [];
    this.loading = false;
    this.filters = {
      active: 'any',
      accessible: 'any',
    };
  }

  async connectedCallback() {
    componentRegistry.set(this.componentId, this);
    this.render();
    await this.loadLoos();
    this.initMap();
  }

  disconnectedCallback() {
    componentRegistry.delete(this.componentId);
    if (this.map) {
      this.map.remove();
      this.map = null;
    }
  }

  async loadLoos() {
    this.loading = true;

    try {
      const params = {};

      Object.entries(this.filters).forEach(([key, value]) => {
        if (value !== 'any') {
          params[key] = value;
        }
      });

      // Use the dedicated admin map endpoint for better performance
      const response = await apiService.getAdminMapData(params);
      this.loos = response.data.map(loo => ({
        id: loo.id,
        location: loo.location,
        active: loo.active,
        accessible: loo.accessible,
        babyChange: loo.babyChange,
        radar: loo.radar,
        noPayment: loo.noPayment,
        name: loo.name,
        area: loo.areaName ? [{ name: loo.areaName }] : []
      }));
      this.loading = false;
      this.updateMarkers();
    } catch (error) {
      console.error('Failed to load loos:', error);
      this.loading = false;
    }
  }

  initMap() {
    const mapContainer = this.querySelector('#map-container');
    if (!mapContainer || this.map) return;

    // Initialize Leaflet map
    this.map = L.map('map-container').setView([54.0, -2.5], 6);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(this.map);

    this.updateMarkers();
  }

  updateMarkers() {
    if (!this.map) return;

    // Clear existing marker cluster group
    if (this.markerClusterGroup) {
      this.map.removeLayer(this.markerClusterGroup);
    }

    // Create new marker cluster group
    this.markerClusterGroup = L.markerClusterGroup({
      // Customize cluster appearance
      iconCreateFunction: function(cluster) {
        const childCount = cluster.getChildCount();
        let c = ' marker-cluster-';
        if (childCount < 10) {
          c += 'small';
        } else if (childCount < 100) {
          c += 'medium';
        } else {
          c += 'large';
        }

        return new L.DivIcon({
          html: '<div><span>' + childCount + '</span></div>',
          className: 'marker-cluster' + c,
          iconSize: new L.Point(40, 40)
        });
      },
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      maxClusterRadius: 50
    });

    if (this.loos.length === 0) return;

    // Add markers for each loo
    this.loos.forEach(loo => {
      if (!loo.location) return;

      const icon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
          width: 24px;
          height: 24px;
          background: ${loo.active ? '#10b981' : '#ef4444'};
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          cursor: pointer;
        "></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([loo.location.lat, loo.location.lng], { icon })
        .bindPopup(`
          <div style="min-width: 200px;">
            <h4 style="margin: 0 0 0.5rem 0; font-size: 1rem; font-weight: 600;">
              ${loo.name || 'Unnamed'}
            </h4>
            <div style="font-size: 0.875rem; color: var(--color-text-secondary); margin-bottom: 0.5rem;">
              ${loo.area?.[0]?.name || 'No area'}
            </div>
            <div style="margin-bottom: 0.5rem;">
              ${loo.active ?
                '<span style="display: inline-block; padding: 0.25rem 0.5rem; background: #d1fae5; color: #065f46; border-radius: 0.25rem; font-size: 0.75rem;">Active</span>' :
                '<span style="display: inline-block; padding: 0.25rem 0.5rem; background: #fee2e2; color: #991b1b; border-radius: 0.25rem; font-size: 0.75rem;">Inactive</span>'
              }
            </div>
            <div style="display: flex; gap: 0.5rem; margin-bottom: 0.75rem;">
              ${loo.accessible ? '♿' : ''}
              ${loo.babyChange ? '🍼' : ''}
              ${loo.radar ? '🔑' : ''}
              ${loo.noPayment ? '💚' : ''}
            </div>
            <button
              onclick="import('/admin/utils/EventBus.js').then(m => m.eventBus.emit('view-changed', { view: 'edit', looId: '${loo.id}' }))"
              style="
                width: 100%;
                padding: 0.5rem;
                background: var(--color-primary);
                color: white;
                border: none;
                border-radius: 0.375rem;
                cursor: pointer;
                font-size: 0.875rem;
                font-weight: 500;
              "
            >
              View Details
            </button>
          </div>
        `);

      this.markerClusterGroup.addLayer(marker);
    });

    // Add the marker cluster group to the map
    this.map.addLayer(this.markerClusterGroup);

    // Fit bounds to show all markers
    if (this.loos.length > 0) {
      this.map.fitBounds(this.markerClusterGroup.getBounds().pad(0.1));
    }
  }

  handleFilterChange(key, value) {
    this.filters[key] = value;
    this.loadLoos();
  }

  render() {
    this.innerHTML = `
      <div style="max-width: 1400px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem;">
          <h1 style="font-size: 1.5rem;">Map View</h1>
          <div style="display: flex; gap: 1rem;">
            <div>
              <label>Active</label>
              <select onchange="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').handleFilterChange('active', this.value))">
                <option value="any" ${this.filters.active === 'any' ? 'selected' : ''}>Any</option>
                <option value="true" ${this.filters.active === 'true' ? 'selected' : ''}>Yes</option>
                <option value="false" ${this.filters.active === 'false' ? 'selected' : ''}>No</option>
              </select>
            </div>
            <div>
              <label>Accessible</label>
              <select onchange="import('/admin/utils/registry.js').then(m => m.componentRegistry.get('${this.componentId}').handleFilterChange('accessible', this.value))">
                <option value="any" ${this.filters.accessible === 'any' ? 'selected' : ''}>Any</option>
                <option value="true" ${this.filters.accessible === 'true' ? 'selected' : ''}>Yes</option>
                <option value="false" ${this.filters.accessible === 'false' ? 'selected' : ''}>No</option>
              </select>
            </div>
          </div>
        </div>

        <div style="background: white; border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-md);">
          <div
            id="map-container"
            style="width: 100%; height: 700px; position: relative;"
          >
            ${this.loading ? `
              <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 1000;">
                <div class="loading" style="width: 2rem; height: 2rem;"></div>
              </div>
            ` : ''}
          </div>
        </div>

        <div style="margin-top: 1rem; padding: 1rem; background: white; border-radius: var(--radius-md); box-shadow: var(--shadow-sm);">
          <div style="display: flex; gap: 2rem; align-items: center; font-size: 0.875rem;">
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <div style="width: 16px; height: 16px; background: #10b981; border: 2px solid white; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.2);"></div>
              <span>Active</span>
            </div>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <div style="width: 16px; height: 16px; background: #ef4444; border: 2px solid white; border-radius: 50%; box-shadow: 0 1px 2px rgba(0,0,0,0.2);"></div>
              <span>Inactive</span>
            </div>
            <div style="margin-left: auto; color: var(--color-text-secondary);">
              Showing ${this.loos.length} loos with locations
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define('loo-map', LooMap);
