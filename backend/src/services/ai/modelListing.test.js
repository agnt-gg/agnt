import { describe, expect, it } from 'vitest';
import { LISTING_SOURCE, listing, provenanceFields, redactUpstreamError } from './modelListing.js';

describe('provenanceFields', () => {
  it.each([
    [LISTING_SOURCE.LIVE, null, false],
    [LISTING_SOURCE.CACHE, null, false],
    [LISTING_SOURCE.CACHE, 'refresh failed', true],
    [LISTING_SOURCE.PERSISTED, 'HTTP 403', true],
    [LISTING_SOURCE.FALLBACK, null, true],
    [LISTING_SOURCE.STATIC, null, false],
  ])('%s with error %s → stale=%s', (source, error, stale) => {
    expect(provenanceFields(listing(source, { error })).stale).toBe(stale);
  });

  it('reports the vendor time as ISO, and null when never fetched', () => {
    expect(provenanceFields(listing('live', { fetchedAt: 0 })).fetchedAt).toBeNull();
    expect(provenanceFields(listing('live', { fetchedAt: Date.UTC(2026, 8, 30) })).fetchedAt).toBe('2026-09-30T00:00:00.000Z');
  });

  it('treats a missing record as an unverified fallback, never as live', () => {
    expect(provenanceFields(undefined)).toMatchObject({ source: 'fallback', stale: true });
  });
});

describe('redactUpstreamError', () => {
  it('removes the exact key, query-string keys, bearer tokens and vendor-prefixed keys', () => {
    const text = redactUpstreamError(
      'request to https://x/models?key=AIzaSECRET123456789 failed; Authorization: Bearer abcdefghijklmnop; got sk-proj-ABCDEFGHIJKLMNOP; echo MYKEY-999999',
      'MYKEY-999999',
    );
    for (const secret of ['AIzaSECRET123456789', 'abcdefghijklmnop', 'sk-proj-ABCDEFGHIJKLMNOP', 'MYKEY-999999']) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('key=[redacted]');
  });

  it('keeps the useful part of the message and bounds its length', () => {
    expect(redactUpstreamError('Grok AI API error: 403 Forbidden - used all available credits')).toBe('Grok AI API error: 403 Forbidden - used all available credits');
    expect(redactUpstreamError('x'.repeat(5000))).toHaveLength(300);
    expect(redactUpstreamError(undefined)).toBe('');
  });
});
