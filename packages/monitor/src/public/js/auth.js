// Auth module - handles login/logout and token management
const auth = {
  // Get stored token
  getToken() {
    return localStorage.getItem('monitor_token');
  },

  // Store token
  setToken(token) {
    localStorage.setItem('monitor_token', token);
  },

  // Clear token
  clearToken() {
    localStorage.removeItem('monitor_token');
  },

  // Check if logged in
  isLoggedIn() {
    return this.getToken() !== null;
  },

  // Login with password (username is fixed as 'admin')
  async login(password) {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'admin',
        password: password,
      }),
    });
    const data = await response.json();
    if (data.success) {
      this.setToken(data.token);
    }
    return data;
  },

  // Logout
  async logout() {
    const token = this.getToken();
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
    }
    this.clearToken();
    window.location.href = '/';
  },

  // Verify token is still valid
  async verify() {
    const token = this.getToken();
    if (!token) return false;

    try {
      const response = await fetch('/api/auth/verify', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await response.json();
      return data.success;
    } catch {
      return false;
    }
  },

  // Redirect to login if not authenticated
  async requireAuth() {
    const valid = await this.verify();
    if (!valid) {
      this.clearToken();
      window.location.href = '/';
    }
    return valid;
  },
};