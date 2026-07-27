import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { rateLimit, clientKey, _resetRateLimits } from './rateLimit.js';

function ctx(ip = '1.2.3.4', headers = {}) {
  const req = { ip, headers, socket: { remoteAddress: ip } };
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
  return { req, res, next: vi.fn() };
}

beforeEach(() => _resetRateLimits());
afterEach(() => vi.useRealTimers());

describe('rateLimit', () => {
  it('allows up to the limit then 429s', () => {
    const mw = rateLimit({ name: 't', limit: 3, windowMs: 1000 });
    const results = [];
    for (let i = 0; i < 5; i++) {
      const { req, res, next } = ctx();
      mw(req, res, next);
      results.push(next.mock.calls.length === 1 ? 'pass' : res.statusCode);
    }
    expect(results).toEqual(['pass', 'pass', 'pass', 429, 429]);
  });

  it('keys independently per client', () => {
    const mw = rateLimit({ name: 't', limit: 1, windowMs: 1000 });
    const a = ctx('1.1.1.1');
    const b = ctx('2.2.2.2');
    mw(a.req, a.res, a.next);
    mw(b.req, b.res, b.next);
    expect(a.next).toHaveBeenCalledOnce();
    expect(b.next).toHaveBeenCalledOnce();
  });

  it('keys independently per bucket name', () => {
    const one = rateLimit({ name: 'one', limit: 1, windowMs: 1000 });
    const two = rateLimit({ name: 'two', limit: 1, windowMs: 1000 });
    const a = ctx();
    const b = ctx();
    one(a.req, a.res, a.next);
    two(b.req, b.res, b.next);
    expect(a.next).toHaveBeenCalledOnce();
    expect(b.next).toHaveBeenCalledOnce();
  });

  it('resets after the window elapses', () => {
    vi.useFakeTimers();
    const mw = rateLimit({ name: 't', limit: 1, windowMs: 1000 });
    const a = ctx();
    mw(a.req, a.res, a.next);
    const b = ctx();
    mw(b.req, b.res, b.next);
    expect(b.res.statusCode).toBe(429);

    vi.advanceTimersByTime(1001);
    const c = ctx();
    mw(c.req, c.res, c.next);
    expect(c.next).toHaveBeenCalledOnce();
  });

  it('sets standard rate-limit headers including Retry-After on rejection', () => {
    const mw = rateLimit({ name: 't', limit: 1, windowMs: 5000 });
    const a = ctx();
    mw(a.req, a.res, a.next);
    expect(a.res.headers['X-RateLimit-Remaining']).toBe('0');

    const b = ctx();
    mw(b.req, b.res, b.next);
    expect(Number(b.res.headers['Retry-After'])).toBeGreaterThan(0);
    expect(b.res.body.error).toBe('Too many requests');
  });

  it('rejects a misconfigured limiter at construction, not at request time', () => {
    expect(() => rateLimit({ name: 'x' })).toThrow();
    expect(() => rateLimit({ limit: 1, windowMs: 1 })).toThrow();
  });
});

describe('clientKey', () => {
  let prev;
  beforeEach(() => { prev = process.env.TRUST_PROXY; delete process.env.TRUST_PROXY; });
  afterEach(() => { if (prev === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = prev; });

  it('uses the socket address by default and IGNORES a spoofed XFF', () => {
    const { req } = ctx('9.9.9.9', { 'x-forwarded-for': '1.1.1.1' });
    expect(clientKey(req)).toBe('9.9.9.9');
  });

  it('honours the left-most XFF entry only when behind a trusted proxy', () => {
    process.env.TRUST_PROXY = 'true';
    const { req } = ctx('9.9.9.9', { 'x-forwarded-for': '1.1.1.1, 2.2.2.2' });
    expect(clientKey(req)).toBe('1.1.1.1');
  });
});
