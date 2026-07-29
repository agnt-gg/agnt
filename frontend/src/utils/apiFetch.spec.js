import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, authHeaders, jsonAuthHeaders, getAuthToken } from './apiFetch.js';

describe('apiFetch', () => {
  beforeEach(() => {
    localStorage.clear();
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  });
  afterEach(() => vi.restoreAllMocks());

  describe('authHeaders', () => {
    it('attaches the bearer token when one is stored', () => {
      localStorage.setItem('token', 'abc123');
      expect(authHeaders().Authorization).toBe('Bearer abc123');
    });

    it('omits Authorization entirely when signed out', () => {
      // An `Authorization: Bearer null` header is worse than none: the backend
      // distinguishes "missing" from "invalid" and would report the wrong one.
      expect(authHeaders()).not.toHaveProperty('Authorization');
    });

    it('does NOT add Content-Type', () => {
      // FormData uploads rely on the browser generating the multipart boundary.
      localStorage.setItem('token', 't');
      expect(authHeaders()).not.toHaveProperty('Content-Type');
    });

    it('preserves caller-supplied headers', () => {
      localStorage.setItem('token', 't');
      expect(authHeaders({ 'X-Trace': '1' })).toEqual({ 'X-Trace': '1', Authorization: 'Bearer t' });
    });

    it('survives localStorage throwing', () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      expect(() => authHeaders()).not.toThrow();
      expect(getAuthToken()).toBeNull();
      spy.mockRestore();
    });
  });

  describe('jsonAuthHeaders', () => {
    it('adds Content-Type and the token', () => {
      localStorage.setItem('token', 't');
      expect(jsonAuthHeaders()).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
    });

    it('lets the caller override Content-Type', () => {
      expect(jsonAuthHeaders({ 'Content-Type': 'text/plain' })['Content-Type']).toBe('text/plain');
    });
  });

  describe('apiFetch', () => {
    it('sends the token on a plain GET', async () => {
      localStorage.setItem('token', 'tok');
      await apiFetch('/api/plugins/updates');
      expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    });

    it('defaults JSON bodies to application/json', async () => {
      localStorage.setItem('token', 'tok');
      await apiFetch('/api/plugins/install', { method: 'POST', body: '{}' });
      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers['Content-Type']).toBe('application/json');
      expect(options.method).toBe('POST');
      expect(options.body).toBe('{}');
    });

    it('does NOT set Content-Type for a FormData body', async () => {
      localStorage.setItem('token', 'tok');
      const form = new FormData();
      form.append('audio', new Blob(['x']), 'a.webm');
      await apiFetch('/api/speech/transcribe', { method: 'POST', body: form });
      const [, options] = global.fetch.mock.calls[0];
      expect(options.headers).not.toHaveProperty('Content-Type');
      expect(options.headers.Authorization).toBe('Bearer tok');
    });

    it('merges caller headers without dropping auth', async () => {
      localStorage.setItem('token', 'tok');
      await apiFetch('/api/x', { headers: { 'X-Trace': 'abc' } });
      const { headers } = global.fetch.mock.calls[0][1];
      expect(headers['X-Trace']).toBe('abc');
      expect(headers.Authorization).toBe('Bearer tok');
    });

    it('forwards signal and other RequestInit options', async () => {
      const controller = new AbortController();
      await apiFetch('/api/x', { method: 'DELETE', signal: controller.signal });
      const [, options] = global.fetch.mock.calls[0];
      expect(options.method).toBe('DELETE');
      expect(options.signal).toBe(controller.signal);
    });

    it('returns the raw Response so callers keep control', async () => {
      const response = await apiFetch('/api/x');
      expect(response.ok).toBe(true);
    });
  });
});
