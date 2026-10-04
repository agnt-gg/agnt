/**
 * The agnt.gg update check. It once failed on every call for two months
 * without a single log line, so each failure mode here must reject with a
 * message a person can act on, and the happy path must really fetch.
 */

import { describe, it, expect, vi } from 'vitest';
import { checkForUpdate, updateCheckUrl, updatePlatformId } from './updateCheck.js';

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('checkForUpdate', () => {
  it('fetches the feed for this version and platform and returns its answer', async () => {
    const answer = { updateAvailable: false, currentVersion: '0.6.6', latestVersion: '0.6.6' };
    const fetch = vi.fn(async () => jsonResponse(answer));

    await expect(checkForUpdate({ fetch, version: '0.6.6', platformId: 'win' })).resolves.toEqual(answer);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://agnt.gg/api/updates/check?version=0.6.6&platform=win');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects, naming the status, when the feed answers with an error', async () => {
    const fetch = async () => jsonResponse({ error: 'down' }, 503);
    await expect(checkForUpdate({ fetch, version: '0.6.6' })).rejects.toThrow('update check failed: HTTP 503');
  });

  it('rejects when the network call itself throws', async () => {
    const fetch = async () => {
      throw new TypeError('getaddrinfo ENOTFOUND agnt.gg');
    };
    await expect(checkForUpdate({ fetch, version: '0.6.6' })).rejects.toThrow(
      'update check failed: getaddrinfo ENOTFOUND agnt.gg'
    );
  });

  it('gives up after the timeout instead of hanging', async () => {
    // A server that never answers: only the abort signal can end this.
    const fetch = (_url, { signal }) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    await expect(checkForUpdate({ fetch, version: '0.6.6', timeoutMs: 20 })).rejects.toThrow(
      'update check failed: no answer within 20ms'
    );
  });

  it('rejects a body that is not JSON, or not the feed shape', async () => {
    const html = async () => new Response('<html>captive portal</html>', { status: 200 });
    await expect(checkForUpdate({ fetch: html, version: '0.6.6' })).rejects.toThrow('response was not JSON');

    const wrongShape = async () => jsonResponse({ hello: 'world' });
    await expect(checkForUpdate({ fetch: wrongShape, version: '0.6.6' })).rejects.toThrow('no updateAvailable flag');
  });
});

describe('update feed addressing', () => {
  it('maps each platform to the id the feed is keyed by', () => {
    expect(updatePlatformId('win32', 'x64')).toBe('win');
    expect(updatePlatformId('darwin', 'arm64')).toBe('mac-arm');
    expect(updatePlatformId('darwin', 'x64')).toBe('mac-intel');
    expect(updatePlatformId('linux', 'x64')).toBe('linux-appimage');
  });

  it('escapes the version into the query string', () => {
    expect(updateCheckUrl('0.7.0-beta+1', 'win')).toBe(
      'https://agnt.gg/api/updates/check?version=0.7.0-beta%2B1&platform=win'
    );
  });
});
