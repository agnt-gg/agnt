/**
 * CONTRACT for the live-browser-surface registry.
 *
 * This is the join between a browser the renderer is showing and an agent run
 * that happens in the backend. Two properties matter and neither is obvious:
 *
 *   - only a LOOPBACK bridge may be registered, or this becomes a way to point
 *     the agent at an arbitrary CDP endpoint somewhere on the network;
 *   - a surface must be findable within a second or two of appearing, because
 *     calling the tool ALSO opens the window it is looking for.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSurface,
  unregisterSurface,
  getActiveSurface,
  waitForSurface,
  isLocalBridgeUrl,
  _resetSurfaces,
} from './browserSurfaces.js';

const CDP = 'ws://127.0.0.1:51234/tok3n-value';

beforeEach(() => _resetSurfaces());

describe('only local bridges may be registered', () => {
  it('accepts the shape CdpBridge mints', () => {
    expect(isLocalBridgeUrl(CDP)).toBe(true);
    expect(registerSurface('u1', 'w_1', { cdpUrl: CDP })).toBe(true);
  });

  it('refuses anything that is not loopback', () => {
    for (const bad of [
      'ws://10.0.0.5:9222/token',
      'ws://evil.example.com/token',
      'wss://127.0.0.1:9222/token',
      'http://127.0.0.1:9222/token',
      '',
      null,
    ]) {
      expect(isLocalBridgeUrl(bad), `${bad} should be refused`).toBe(false);
      expect(registerSurface('u1', 'w_1', { cdpUrl: bad })).toBe(false);
    }
    expect(getActiveSurface('u1')).toBeNull();
  });

  it('requires both a user and an instance', () => {
    expect(registerSurface(null, 'w_1', { cdpUrl: CDP })).toBe(false);
    expect(registerSurface('u1', null, { cdpUrl: CDP })).toBe(false);
  });
});

describe('finding the browser a chat turn means', () => {
  it('returns nothing when no window is open', () => {
    expect(getActiveSurface('u1')).toBeNull();
  });

  it('keeps users apart', () => {
    registerSurface('u1', 'w_1', { cdpUrl: CDP });
    expect(getActiveSurface('u2')).toBeNull();
    expect(getActiveSurface('u1').instanceId).toBe('w_1');
  });

  it('picks the window that moved most recently', async () => {
    registerSurface('u1', 'w_1', { cdpUrl: 'ws://127.0.0.1:1111/aaa' });
    await new Promise((r) => setTimeout(r, 5));
    registerSurface('u1', 'w_2', { cdpUrl: 'ws://127.0.0.1:2222/bbb' });
    expect(getActiveSurface('u1').instanceId).toBe('w_2');

    // Navigating in the first window re-announces it, which is the honest
    // signal for "the one the user is actually working in".
    await new Promise((r) => setTimeout(r, 5));
    registerSurface('u1', 'w_1', { cdpUrl: 'ws://127.0.0.1:1111/aaa', url: 'https://example.com' });
    expect(getActiveSurface('u1').instanceId).toBe('w_1');
    expect(getActiveSurface('u1').url).toBe('https://example.com');
  });

  it('forgets a window that closed', () => {
    registerSurface('u1', 'w_1', { cdpUrl: CDP });
    expect(unregisterSurface('u1', 'w_1')).toBe(true);
    expect(getActiveSurface('u1')).toBeNull();
    expect(unregisterSurface('u1', 'w_1')).toBe(false);
  });
});

describe('waiting for a window that is still opening', () => {
  it('returns immediately when one is already there', async () => {
    registerSurface('u1', 'w_1', { cdpUrl: CDP });
    expect((await waitForSurface('u1', 500, 10)).instanceId).toBe('w_1');
  });

  it('waits for a window that appears a moment later', async () => {
    // The real race: calling ai_browser_use auto-opens the Browser widget, so
    // the tool starts looking before the window has finished mounting.
    setTimeout(() => registerSurface('u1', 'w_late', { cdpUrl: CDP }), 60);
    const surface = await waitForSurface('u1', 1000, 10);
    expect(surface.instanceId).toBe('w_late');
  });

  it('gives up rather than hanging when no window ever appears', async () => {
    const started = Date.now();
    expect(await waitForSurface('u1', 80, 10)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
