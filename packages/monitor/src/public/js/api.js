// API module - wraps API calls with auth header
const api = {
  // Make authenticated API request
  async request(url, options = {}) {
    const token = auth.getToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      auth.clearToken();
      window.location.href = '/';
      throw new Error('Session expired');
    }

    return response.json();
  },

  // GET request
  async get(url) {
    return this.request(url, { method: 'GET' });
  },

  // POST request
  async post(url, body) {
    return this.request(url, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // PUT request
  async put(url, body) {
    return this.request(url, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  // DELETE request
  async delete(url) {
    return this.request(url, { method: 'DELETE' });
  },

  // Instance API
  async getInstances() {
    return this.get('/api/instances');
  },

  async getInstance(id) {
    return this.get(`/api/instances/${id}`);
  },

  // Container API
  async getContainers(instanceId) {
    return this.get(`/api/instances/${instanceId}/containers`);
  },

  async getContainerLogs(instanceId, containerId) {
    return this.get(`/api/instances/${instanceId}/containers/${containerId}/logs`);
  },

  // Group API
  async getGroups(instanceId) {
    return this.get(`/api/instances/${instanceId}/groups`);
  },

  async getSkills(instanceId, folder) {
    return this.get(`/api/instances/${instanceId}/groups/${folder}/skills`);
  },

  async getMemory(instanceId, folder) {
    return this.get(`/api/instances/${instanceId}/groups/${folder}/memory`);
  },
};