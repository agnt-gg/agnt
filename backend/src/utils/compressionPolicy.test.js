import { describe, it, expect, vi } from 'vitest';
import { shouldCompress } from './compressionPolicy.js';

const request = (path, { address = '127.0.0.1', headers = {} } = {}) => ({ path, headers, socket: { remoteAddress: address } });
const response = (contentType = 'text/html') => ({ getHeader: () => contentType });

describe('compression policy', () => {
  it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])('sends local files to a loopback caller (%s) uncompressed', (address) => {
    const defaultFilter = vi.fn(() => true);
    for (const path of ['/api/local-file/C:/a.html', '/api/local-preview/C:/a.html', '/api/local-file']) {
      expect(shouldCompress(request(path, { address }), response(), defaultFilter)).toBe(false);
    }
    expect(defaultFilter).not.toHaveBeenCalled();
  });

  it('still compresses local files for a caller on another machine', () => {
    expect(shouldCompress(request('/api/local-preview/C:/a.html', { address: '192.168.1.20' }), response(), () => true)).toBe(true);
  });

  it('matches whole route segments only', () => {
    expect(shouldCompress(request('/api/local-files/x'), response(), () => true)).toBe(true);
  });

  it('keeps every existing streaming exclusion', () => {
    expect(shouldCompress(request('/api/orchestrator/chat', { address: '10.0.0.2' }), response(), () => true)).toBe(false);
    expect(shouldCompress(request('/api/agents', { address: '10.0.0.2', headers: { 'x-no-compression': '1' } }), response(), () => true)).toBe(false);
    expect(shouldCompress(request('/api/agents', { address: '10.0.0.2' }), response('text/event-stream'), () => true)).toBe(false);
    expect(shouldCompress(request('/api/agents', { address: '10.0.0.2' }), response('application/json'), () => true)).toBe(true);
  });
});
