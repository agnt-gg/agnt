/**
 * Unified provider auth API client.
 * All calls go to BASE_URL/providers/:id/auth/*
 */

import { API_CONFIG } from '@/tt.config.js';
import axios from 'axios';

const base = (providerId) => `${API_CONFIG.BASE_URL}/providers/${providerId}/auth`;

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
};
