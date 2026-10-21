import { describe, it, expect, vi } from 'vitest';
import { assertSignInsPublishable, publishFailureMessage } from './pluginPublishCheck.js';

const reply = (status, body) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));
const input = (fetchImpl) => ({ baseUrl: 'http://local/api', token: 't', packageBase64: 'AAAA', fetchImpl });

describe('publishFailureMessage', () => {
  it('names every reason the marketplace gave, not just "failed validation"', () => {
    const message = publishFailureMessage({ error: 'Plugin package failed validation', details: ['tools need the "calendly" sign-in…'] });
    expect(message).toBe('Plugin package failed validation:\n\n• tools need the "calendly" sign-in…');
  });

  it('falls back when the body says nothing', () => {
    expect(publishFailureMessage(null, 'Failed to publish plugin')).toBe('Failed to publish plugin');
    expect(publishFailureMessage({ error: 'Nope', details: [] })).toBe('Nope');
  });
});

describe('assertSignInsPublishable', () => {
  // Reported 2026-10-21: Calendly was published needing its author's private sign-in.
  it('stops before upload when a sign-in only its author could connect, and says why', async () => {
    const fetchImpl = reply(200, { publishable: false, signInErrors: [], signInPublishErrors: ['tools need the "calendly" sign-in, which is neither declared in manifest.auth nor a shared AGNT sign-in…'] });
    await expect(assertSignInsPublishable(input(fetchImpl))).rejects.toThrow(/can’t be published yet:\n\n• tools need the "calendly" sign-in/);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://local/api/plugins/install-file/check-auth');
    expect(JSON.parse(init.body)).toEqual({ fileData: 'AAAA' });
  });

  it('lets it through when publishable, or when the local check cannot tell (the marketplace decides)', async () => {
    await expect(assertSignInsPublishable(input(reply(200, { publishable: true })))).resolves.toBeUndefined();
    await expect(assertSignInsPublishable(input(reply(200, { publishable: null })))).resolves.toBeUndefined();
    await expect(assertSignInsPublishable(input(reply(500, {})))).resolves.toBeUndefined();
    await expect(assertSignInsPublishable(input(vi.fn(async () => { throw new Error('offline'); })))).resolves.toBeUndefined();
  });
});
