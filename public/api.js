/**
 * Module: API-Client
 * Purpose: Fetch wrapper with session auth, uniform error handling and JSON parsing
 * Dependencies: none
 */

const API_BASE = '/api/v1';

/** Reads the CSRF token from the cookie (set by the server after login). */
function getCsrfToken() {
  return document.cookie.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('csrf-token='))
    ?.slice('csrf-token='.length) ?? '';
}

/**
 * Central fetch wrapper.
 * Sets Content-Type, handles 401 redirects and parses JSON errors.
 *
 * @param {string} path - API path without /api/v1 (e.g. '/tasks')
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<any>} Parsed JSON or throws an error
 */
async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;

  const method = options.method ?? 'GET';
  const stateChanging = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(stateChanging ? { 'X-CSRF-Token': getCsrfToken() } : {}),
      ...options.headers,
    },
    ...options,
  });

  if (response.status === 401) {
    // Session expired → redirect to login page
    window.dispatchEvent(new CustomEvent('auth:expired'));
    throw new Error('Sitzung abgelaufen.');
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message = data?.error || `HTTP ${response.status}`;
    throw new ApiError(message, response.status, data);
  }

  return data;
}

/**
 * Structured API error with HTTP status code.
 */
class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// --------------------------------------------------------
// Convenience methods
// --------------------------------------------------------

const api = {
  get: (path) => apiFetch(path, { method: 'GET' }),

  post: (path, body) => apiFetch(path, {
    method: 'POST',
    body: JSON.stringify(body),
  }),

  put: (path, body) => apiFetch(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  }),

  patch: (path, body) => apiFetch(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  }),

  delete: (path) => apiFetch(path, { method: 'DELETE' }),
};

// --------------------------------------------------------
// Auth-specific methods
// --------------------------------------------------------

const auth = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  getUsers: () => api.get('/auth/users'),
  createUser: (data) => api.post('/auth/users', data),
  deleteUser: (id) => api.delete(`/auth/users/${id}`),
  setupRequired: () => api.get('/auth/setup-required'),
  setup: (data) => api.post('/auth/setup', data),
  verifyPassword: (password) => api.post('/auth/me/verify-password', { password }),
};

export { api, auth, ApiError };
