/**
 * Unified provider auth API client.
 * All calls go to BASE_URL/providers/:id/auth/*
 */

import { API_CONFIG } from '@/tt.config.js';
import axios from 'axios';

const base = (providerId) => `${API_CONFIG.BASE_URL}/providers/${providerId}/auth`;

// Tracks in-flight remote-OAuth code exchanges so a duplicate postMessage
// doesn't POST the same single-use code twice (the second POST would 400 and
// look like a generic OAuth failure to the user).
const inFlightExchanges = new Map();

export default {
  getStatus(providerId) {
    return axios.get(`${base(providerId)}/status`).then((r) => r.data);
  },

  getCapabilities(providerId) {
    return axios.get(`${base(providerId)}/capabilities`).then((r) => r.data);
  },

  connect(providerId, payload) {
    return axios.post(`${base(providerId)}/connect`, payload).then((r) => r.data);
  },

  disconnect(providerId) {
    return axios.post(`${base(providerId)}/disconnect`).then((r) => r.data);
  },

  refresh(providerId) {
    return axios.post(`${base(providerId)}/refresh`).then((r) => r.data);
  },

  startOAuth(providerId) {
    return axios.get(`${base(providerId)}/oauth/start`).then((r) => r.data);
  },

  exchangeOAuth(providerId, payload) {
    return axios.post(`${base(providerId)}/oauth/exchange`, payload).then((r) => r.data);
  },

  pollOAuthStatus(providerId, sessionId) {
    return axios.get(`${base(providerId)}/oauth/status`, { params: { sessionId } }).then((r) => r.data);
  },

  startDeviceAuth(providerId) {
    return axios.post(`${base(providerId)}/device/start`).then((r) => r.data);
  },

  pollDeviceAuth(providerId, sessionId) {
    return axios.get(`${base(providerId)}/device/status`, { params: { sessionId } }).then((r) => r.data);
  },

  setAuthMethod(providerId, method) {
    return axios.post(`${base(providerId)}/set-auth-method`, { method }).then((r) => r.data);
  },

  setGcpProject(providerId, projectId) {
    return axios.post(`${base(providerId)}/gcp-project`, { projectId }).then((r) => r.data);
  },

  // Exchanges an OAuth `code` for tokens against the remote auth server.
  // Used by the Electron postMessage path: api.agnt.gg's callback page only
  // forwards the code via postMessage and does NOT exchange it server-side,
  // so the opener has to finish the exchange. Browser/dev mode does the
  // exchange inside the popup itself (OAuthCallback.vue) and never hits
  // this method.
  //
  // Dedupes by `code` so an accidental double postMessage (e.g. multiple
  // listeners mounted across screens) doesn't burn the single-use code.
  completeRemoteOAuthCallback({ code, state }) {
    if (!code || !state) {
      return Promise.reject(new Error('Missing code or state'));
    }
    if (inFlightExchanges.has(code)) {
      return inFlightExchanges.get(code);
    }
    const token = localStorage.getItem('token');
    const promise = axios
      .post(
        `${API_CONFIG.REMOTE_URL}/auth/callback`,
        { code, state },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
      )
      .then((r) => r.data)
      .finally(() => {
        // Keep the entry briefly so a late-arriving duplicate postMessage
        // still hits the cached result instead of re-firing the request.
        setTimeout(() => inFlightExchanges.delete(code), 30000);
      });
    inFlightExchanges.set(code, promise);
    return promise;
  },
};
