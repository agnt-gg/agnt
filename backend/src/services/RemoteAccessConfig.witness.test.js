import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordExternalRequest,
  getLastExternalRequest,
  normalizeIp,
  _resetExternalRequest,
} from './RemoteAccessConfig.js';

beforeEach(() => _resetExternalRequest());

describe('normalizeIp', () => {
  it('strips the IPv6-mapped-IPv4 prefix Node reports on dual-stack sockets', () => {
    // Without this, every phone shows up as "::ffff:192.168.40.42" and the
    // loopback check below fails to recognise "::ffff:127.0.0.1" as local.
    expect(normalizeIp('::ffff:192.168.40.42')).toBe('192.168.40.42');
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });
  it('passes through plain addresses and tolerates junk', () => {
    expect(normalizeIp('192.168.1.5')).toBe('192.168.1.5');
    expect(normalizeIp(undefined)).toBe('');
    expect(normalizeIp(42)).toBe('');
  });
});

describe('recordExternalRequest', () => {
  it('records a genuine LAN client', () => {
    recordExternalRequest({ ip: '192.168.40.42', path: '/pair' });
    const hit = getLastExternalRequest();
    expect(hit.ip).toBe('192.168.40.42');
    expect(hit.path).toBe('/pair');
    expect(hit.at).toBeGreaterThan(0);
  });

  it.each(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1', '127.0.0.53'])(
    'IGNORES loopback address %s',
    (ip) => {
      // The whole value of this signal is "something OTHER than this machine
      // arrived". Counting our own probes would make it always green.
      recordExternalRequest({ ip });
      expect(getLastExternalRequest()).toBeNull();
    }
  );

  it('falls back to socket.remoteAddress when req.ip is absent', () => {
    recordExternalRequest({ socket: { remoteAddress: '::ffff:10.0.0.9' } });
    expect(getLastExternalRequest().ip).toBe('10.0.0.9');
  });

  it('keeps only the most recent hit', () => {
    recordExternalRequest({ ip: '192.168.40.42', path: '/a' });
    recordExternalRequest({ ip: '192.168.40.43', path: '/b' });
    expect(getLastExternalRequest().ip).toBe('192.168.40.43');
  });

  it('truncates the path so a long URL cannot bloat the status payload', () => {
    recordExternalRequest({ ip: '192.168.40.42', path: '/' + 'x'.repeat(500) });
    expect(getLastExternalRequest().path.length).toBe(120);
  });

  it('never throws on a malformed request object', () => {
    expect(() => recordExternalRequest(undefined)).not.toThrow();
    expect(() => recordExternalRequest({})).not.toThrow();
    expect(getLastExternalRequest()).toBeNull();
  });
});
