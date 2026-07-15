import { API_CONFIG } from '@/tt.config.js';

const API = `${API_CONFIG.BASE_URL}/users`;

function headers() {
  const token = localStorage.getItem('token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { ...options, headers: { ...headers(), ...options.headers } });
  const contentType = response.headers.get('content-type') || '';
  const body = await response.text();
  let data = null;

  if (contentType.includes('application/json')) {
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`Security settings returned invalid JSON (${response.status})`);
    }
  }

  if (!response.ok) {
    throw new Error(data?.error || `Security settings request failed (${response.status})`);
  }
  if (!data) {
    throw new Error('Security settings endpoint returned a non-JSON response');
  }
  return data;
}

export const securityPolicyService = {
  getPolicy: () => request('/security-policy'),
  savePolicy: (policy) => request('/security-policy', { method: 'PUT', body: JSON.stringify(policy) }),
  resetPolicy: () => request('/security-policy', { method: 'DELETE' }),
  getAudit: (limit = 50) => request(`/security-audit?limit=${limit}`),
};
