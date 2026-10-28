import { describe, it, expect } from 'vitest';
import { siteOf, groupCookiesBySite } from './browserSites.js';

describe('siteOf', () => {
  it('names the registrable site a cookie domain belongs to', () => {
    expect(siteOf('.google.com')).toBe('google.com');
    expect(siteOf('accounts.google.com')).toBe('google.com');
    expect(siteOf('console.deepgram.com')).toBe('deepgram.com');
    expect(siteOf('.bbc.co.uk')).toBe('bbc.co.uk');
    expect(siteOf('www.abc.net.au')).toBe('abc.net.au');
  });
  it('keeps hosts that have no registrable domain as they are', () => {
    expect(siteOf('localhost')).toBe('localhost');
    expect(siteOf('127.0.0.1')).toBe('127.0.0.1');
    expect(siteOf('example')).toBe('example');
  });
  it('tolerates junk', () => {
    expect(siteOf('')).toBeNull();
    expect(siteOf(null)).toBeNull();
  });
});

describe('groupCookiesBySite', () => {
  it('counts per site, keeps the latest expiry, flags session cookies, and drops every value', () => {
    const sites = groupCookiesBySite([
      { name: 'SID', value: 'SECRET-1', domain: '.google.com', expires: 1800000000 },
      { name: 'NID', value: 'SECRET-2', domain: 'accounts.google.com', expires: 1900000000 },
      { name: 's', value: 'SECRET-3', domain: 'app.example.com', session: true, expires: -1 },
    ]);
    expect(sites).toEqual([
      { site: 'example.com', cookies: 1, session: true, expires: null },
      { site: 'google.com', cookies: 2, session: false, expires: new Date(1900000000 * 1000).toISOString() },
    ]);
    expect(JSON.stringify(sites)).not.toMatch(/SECRET|SID|NID/);
  });
});
