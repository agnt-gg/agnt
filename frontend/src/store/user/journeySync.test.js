import { describe, it, expect, vi } from 'vitest';
import {
  syncJourney, rememberSignInNonce, journeyTrackingAllowed, platformFamily, NONCE_KEY, INSTALL_KEY,
} from './journeySync.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}
const desktop = { electron: {} };
const nav = { platform: 'Win32' };
// A real-shaped JWT whose payload names the account. The site verifies it; the app only reads the subject.
const jwt = (id) => `x.${btoa(JSON.stringify({ id, userId: id })).replace(/=+$/, '')}.sig`;
const ok = (body = {}) => ({ ok: true, json: async () => ({ success: true, ...body }) });
const calls = (fetchImpl) => fetchImpl.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }));
const base = (over = {}) => ({ storage: memoryStorage(), navigator: nav, win: desktop, appVersion: '0.6.8', makeId: () => 'a'.repeat(32), logger: { warn() {} }, ...over });

describe('journey consent and platform', () => {
  it('only the desktop app, never a hosted space, and never against DNT, GPC or opt-out', () => {
    const storage = memoryStorage();
    expect(journeyTrackingAllowed({ storage, navigator: {}, win: desktop })).toBe(true);
    expect(journeyTrackingAllowed({ storage, navigator: {}, win: {} })).toBe(false);
    expect(journeyTrackingAllowed({ storage, navigator: {}, win: { electron: { isSpaceView: true } } })).toBe(false);
    expect(journeyTrackingAllowed({ storage, navigator: { doNotTrack: '1' }, win: desktop })).toBe(false);
    expect(journeyTrackingAllowed({ storage, navigator: { globalPrivacyControl: true }, win: desktop })).toBe(false);
    expect(journeyTrackingAllowed({ storage: memoryStorage({ agnt_analytics_opt_out: '1' }), navigator: {}, win: desktop })).toBe(false);
  });

  it('reports the OS family agnt.gg matches downloads by', () => {
    expect(platformFamily({ platform: 'Win32' })).toBe('win32');
    expect(platformFamily({ platform: 'MacIntel' })).toBe('darwin');
    expect(platformFamily({ platform: 'Linux x86_64' })).toBe('linux');
    expect(platformFamily({ userAgentData: { platform: 'macOS' }, platform: 'Win32' })).toBe('darwin');
    expect(platformFamily({})).toBe('unknown');
  });
});

describe('syncJourney', () => {
  it('signed out: reports one random install, once, with only id, version and OS', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const options = base({ fetchImpl });
    expect(await syncJourney(options)).toEqual({ install: 'sent', claim: 'skipped' });
    expect(await syncJourney(options)).toEqual({ install: 'acknowledged', claim: 'skipped' });
    const [only, ...rest] = calls(fetchImpl);
    expect(rest).toHaveLength(0);
    expect(only).toEqual({ url: 'https://agnt.gg/api/journey/install', body: { install_id: 'a'.repeat(32), app_version: '0.6.8', platform: 'win32' }, auth: undefined });
    expect(JSON.parse(options.storage.getItem(INSTALL_KEY)).acknowledged_at).toBeTruthy();
  });

  it('a failed report is retried after ten minutes, not on every start', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValue(ok());
    const options = base({ fetchImpl, now: 1_000_000 });
    expect((await syncJourney(options)).install).toBe('deferred');
    expect((await syncJourney({ ...options, now: 1_000_000 + 60_000 })).install).toBe('deferred');
    expect((await syncJourney({ ...options, now: 1_000_000 + 11 * 60_000 })).install).toBe('sent');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('signed in: claims once per account, and again only to redeem a browser sign-in nonce', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ journey: 'AGNT-00042' }));
    const options = base({ fetchImpl, token: jwt('account_0001') });
    expect(await syncJourney(options)).toEqual({ install: 'sent', claim: 'sent', journey: 'AGNT-00042' });
    expect((await syncJourney(options)).claim).toBe('skipped');
    rememberSignInNonce(options.storage, 'n'.repeat(64));
    expect((await syncJourney(options)).claim).toBe('sent');
    expect(options.storage.getItem(NONCE_KEY)).toBeNull();
    expect((await syncJourney({ ...options, token: jwt('account_0002') })).claim).toBe('sent');
    const claims = calls(fetchImpl).filter((c) => c.url === 'https://agnt.gg/api/journey/claim');
    expect(claims).toHaveLength(3);
    expect(claims[0]).toEqual({ url: 'https://agnt.gg/api/journey/claim', body: { install_id: 'a'.repeat(32) }, auth: `Bearer ${jwt('account_0001')}` });
    expect(claims[1].body.nonce).toBe('n'.repeat(64));
    expect(JSON.stringify(claims.map((c) => c.body))).not.toContain('account_');
  });

  it('a claim that fails keeps the nonce; an expired nonce is dropped, not sent', async () => {
    const offline = vi.fn().mockRejectedValue(new Error('offline'));
    const options = base({ fetchImpl: offline, token: jwt('account_0001') });
    rememberSignInNonce(options.storage, 'n'.repeat(64));
    expect(await syncJourney(options)).toEqual({ install: 'deferred', claim: 'deferred' });
    expect(options.storage.getItem(NONCE_KEY)).not.toBeNull();

    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const stale = base({ fetchImpl, token: jwt('account_0001'), now: 31 * 60_000 });
    rememberSignInNonce(stale.storage, 'n'.repeat(64), 0);
    await syncJourney(stale);
    expect(calls(fetchImpl).find((c) => c.url.endsWith('/claim')).body).toEqual({ install_id: 'a'.repeat(32) });
    expect(stale.storage.getItem(NONCE_KEY)).toBeNull();
  });

  it('opted out, a web browser or a team space never calls anything', async () => {
    const fetchImpl = vi.fn();
    for (const over of [{ navigator: { doNotTrack: '1' } }, { win: {} }, { win: { electron: { isSpaceView: true } } }, { storage: memoryStorage({ agnt_analytics_opt_out: '1' }) }]) {
      expect(await syncJourney(base({ fetchImpl, token: jwt('account_0001'), ...over }))).toEqual({ skipped: true });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a corrupt stored install is replaced with a fresh id, never sent as-is', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const storage = memoryStorage({ [INSTALL_KEY]: '{"id":"<script>"}' });
    await syncJourney(base({ fetchImpl, storage }));
    expect(calls(fetchImpl)[0].body.install_id).toBe('a'.repeat(32));
  });
});
