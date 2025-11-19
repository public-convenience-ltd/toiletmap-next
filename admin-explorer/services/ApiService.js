import { authService } from './AuthService.js';

const API_BASE = '';

export class ApiService {
  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (authService.isAuthenticated()) {
      headers['Authorization'] = `Bearer ${authService.getToken()}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!response.ok) {
      if (response.status === 401) {
        authService.logout();
        throw new Error('Unauthorized');
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  // Generic GET method
  async get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  }

  // Loos endpoints
  async searchLoos(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') {
        query.append(key, value);
      }
    });
    return this.request(`/loos/search?${query.toString()}`);
  }

  async getLoo(id) {
    return this.request(`/loos/${id}`);
  }

  async createLoo(data) {
    return this.request('/loos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateLoo(id, data) {
    return this.request(`/loos/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteLoo(id) {
    return this.request(`/loos/${id}`, {
      method: 'DELETE',
    });
  }

  async getLooReports(id, hydrate = false) {
    return this.request(`/loos/${id}/reports?hydrate=${hydrate}`);
  }

  async getAreas() {
    return this.request('/areas');
  }

  // Admin endpoints
  async getAdminStats() {
    return this.request('/admin/api/stats');
  }

  async getAdminMapData(params = {}) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '' && value !== 'any') {
        query.append(key, value);
      }
    });
    const queryString = query.toString();
    return this.request(`/admin/api/loos/map${queryString ? `?${queryString}` : ''}`);
  }
}

export const apiService = new ApiService();
