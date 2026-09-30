import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { default: manager } = await import('../../src/services/auth/AntigravityAuthManager.js');

// Shapes captured live 2026-09-30 from this account's real ensureOnboarded() calls.
const LOAD_NOT_ONBOARDED = { allowedTiers: [{ id: 'standard-tier', isDefault: true }], ineligibleTiers: [{ tierId: 'free-tier' }] };
const ONBOARD_SYNC_DONE = { done: true, response: { '@type': 'type.googleapis.com/OnboardUserResponse', cloudaicompanionProject: {} } };

function gateway(responses) {
  const calls = [];
  const request = vi.fn(async (opts) => {
    const method = opts.url.replace(/^.*v1internal/, '');
    calls.push(method);
    const next = responses[method];
    const value = typeof next === 'function' ? next() : next;
    if (value instanceof Error) throw value;
    return { status: 200, data: value };
  });
  return { client: { request }, calls };
}

function forgetAccount() {
  manager._onboarded = false;
  manager._codeAssistProject = null;
  manager._currentTier = null;
  manager._paidTier = null;
}

beforeEach(() => {
  forgetAccount();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(manager, '_readGcpProject').mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
  forgetAccount();
});

describe('Antigravity ensureOnboarded', () => {
  it('REGRESSION: onboards a project-less standard-tier account once, not on every request', async () => {
    const { client, calls } = gateway({ ':loadCodeAssist': LOAD_NOT_ONBOARDED, ':onboardUser': ONBOARD_SYNC_DONE });

    expect(await manager.ensureOnboarded(client)).toBeUndefined(); // no project exists for this account
    expect(calls).toEqual([':loadCodeAssist', ':onboardUser']);

    for (let i = 0; i < 5; i++) await manager.ensureOnboarded(client);
    expect(calls).toHaveLength(2); // previously 2 more per call
  });

  it('reads a project from a synchronous onboardUser response', async () => {
    const { client } = gateway({
      ':loadCodeAssist': LOAD_NOT_ONBOARDED,
      ':onboardUser': { done: true, response: { cloudaicompanionProject: { id: 'proj-123' } } },
    });
    expect(await manager.ensureOnboarded(client)).toBe('proj-123');
  });

  it('still polls a long-running onboarding operation', async () => {
    let polls = 0;
    const { client, calls } = gateway({
      ':loadCodeAssist': LOAD_NOT_ONBOARDED,
      ':onboardUser': { name: 'operations/op-1', done: false },
      '/operations/op-1': () => ({ done: ++polls >= 1, response: { cloudaicompanionProject: { name: 'proj-lro' } } }),
    });
    expect(await manager.ensureOnboarded(client)).toBe('proj-lro');
    await manager.ensureOnboarded(client);
    expect(calls).toEqual([':loadCodeAssist', ':onboardUser', '/operations/op-1']);
  });

  it('treats an already-onboarded tier without a project as onboarded (no onboardUser call)', async () => {
    const { client, calls } = gateway({ ':loadCodeAssist': { currentTier: { id: 'standard-tier' } } });
    await manager.ensureOnboarded(client);
    await manager.ensureOnboarded(client);
    expect(calls).toEqual([':loadCodeAssist']);
    expect(manager._currentTier).toBe('standard-tier');
  });

  it('does not cache a failure: the next request retries', async () => {
    let fail = true;
    const { client, calls } = gateway({
      ':loadCodeAssist': () => (fail ? new Error('socket hang up') : LOAD_NOT_ONBOARDED),
      ':onboardUser': ONBOARD_SYNC_DONE,
    });
    await manager.ensureOnboarded(client);
    fail = false;
    await manager.ensureOnboarded(client);
    await manager.ensureOnboarded(client);
    expect(calls).toEqual([':loadCodeAssist', ':loadCodeAssist', ':onboardUser']);
  });

  // Structural, deliberately: the real methods delete ~/.antigravity credentials
  // or rewrite ~/.antigravity/.env, which a test must never touch.
  it('every account-changing path forgets onboarding (sign-in, GCP project change, logout)', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(new URL('../../src/services/auth/AntigravityAuthManager.js', import.meta.url), 'utf8');
    for (const signature of ['async _exchangeCodeForTokens(code, codeVerifier, redirectUri) {', 'saveGcpProject(projectId) {', 'logout() {']) {
      const start = source.indexOf(`  ${signature}`);
      expect(start, signature).toBeGreaterThan(-1);
      const body = source.slice(start, source.indexOf('\n  }\n', start));
      expect(body, signature).toContain('this._onboarded = false');
    }
  });
});
