/**
 * sessionDiscovery — the "which CLIs are already signed in?" sweep.
 *
 * AuthDispatcher is mocked because importing it really would pull in all six
 * managers (and their google-auth-library / axios trees) to test a loop.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ providers: {}, ids: [] }));

vi.mock('./AuthDispatcher.js', () => ({
  getCliProviderIds: () => h.ids,
  getAuthEntry: (id) => h.providers[id] || null,
}));

vi.mock('./secretStore.js', () => ({
  secretStoreSupported: () => true,
}));

const { discoverSessions } = await import('./sessionDiscovery.js');

/** A manager migrated to the resolver: full provenance. */
function modernManager(described) {
  return { describeCredential: () => described };
}

/** A manager that has not been migrated: presence only. */
function legacyManager(token) {
  return {
    getAccessTokenSync: () => token,
    getCredentialsPath: () => '/legacy/path',
  };
}

function register(id, manager, name = id) {
  h.ids.push(id);
  h.providers[id] = { manager, config: { name } };
}

beforeEach(() => {
  h.providers = {};
  h.ids = [];
});

describe('sweep', () => {
  it('reports an empty machine without failing', () => {
    register('claude-code', modernManager({
      connected: false, source: null, tier: null, ownedByAgnt: false,
      label: 'not connected', credPath: '/x', keychainSupported: true,
    }));

    const result = discoverSessions();

    expect(result.sessions).toHaveLength(1);
    expect(result.connected).toHaveLength(0);
    expect(result.adoptable).toHaveLength(0);
  });

  it('separates sessions AGNT owns from sessions it merely found', () => {
    // This split is the whole point: `adoptable` is what the UI offers as
    // "we found these — use them?".
    register('claude-code', modernManager({
      connected: true, source: 'claude-keychain', tier: 'secret-store',
      ownedByAgnt: false, label: 'CLI session in OS keychain',
      credPath: 'keychain:Claude Code-credentials', keychainSupported: true,
    }));
    register('codex', modernManager({
      connected: true, source: 'agnt-store', tier: 'agnt-store',
      ownedByAgnt: true, label: 'connected in AGNT',
      credPath: '/store/codex.json', keychainSupported: true,
    }));
    register('gemini-cli', modernManager({
      connected: false, source: null, tier: null, ownedByAgnt: false,
      label: 'not connected', credPath: '/x', keychainSupported: true,
    }));

    const result = discoverSessions();

    expect(result.connected.map((s) => s.providerId)).toEqual(['claude-code', 'codex']);
    expect(result.adoptable.map((s) => s.providerId)).toEqual(['claude-code']);
  });

  it('carries the provider name through for display', () => {
    register('claude-code', modernManager({
      connected: true, source: 'agnt-store', tier: 'agnt-store', ownedByAgnt: true,
      label: 'connected in AGNT', credPath: '/x', keychainSupported: true,
    }), 'Claude Code');

    expect(discoverSessions().sessions[0].providerName).toBe('Claude Code');
  });

  it('stamps checkedAt and platform support', () => {
    const result = discoverSessions();
    expect(Date.parse(result.checkedAt)).not.toBeNaN();
    expect(result.secretStoreSupported).toBe(true);
  });
});

describe('tolerance — one bad manager must not blind the sweep', () => {
  it('falls back to a presence check for a manager without describeCredential', () => {
    register('cursor-cli', legacyManager('cursor-cli-session'));

    const [session] = discoverSessions().sessions;

    expect(session.connected).toBe(true);
    expect(session.source).toBe('legacy-manager');
  });

  it('reports a legacy manager with no token as disconnected', () => {
    register('cursor-cli', legacyManager(null));
    expect(discoverSessions().sessions[0].connected).toBe(false);
  });

  it('survives a manager whose describeCredential throws', () => {
    register('claude-code', {
      describeCredential: () => { throw new Error('disk on fire'); },
      getAccessTokenSync: () => 'still-here',
    });

    const [session] = discoverSessions().sessions;

    expect(session.connected).toBe(true);
  });

  it('survives a manager whose every method throws', () => {
    register('broken', {
      describeCredential: () => { throw new Error('x'); },
      getAccessTokenSync: () => { throw new Error('y'); },
    });

    const [session] = discoverSessions().sessions;

    expect(session.connected).toBe(false);
    expect(session.label).toBe('status unavailable');
  });

  it('keeps sweeping after a broken provider', () => {
    register('broken', { describeCredential: () => { throw new Error('x'); } });
    register('codex', modernManager({
      connected: true, source: 'agnt-store', tier: 'agnt-store', ownedByAgnt: true,
      label: 'connected in AGNT', credPath: '/x', keychainSupported: true,
    }));

    expect(discoverSessions().connected.map((s) => s.providerId)).toEqual(['codex']);
  });

  it('skips providers with no manager at all', () => {
    h.ids.push('remote-thing');
    h.providers['remote-thing'] = { manager: null, config: { name: 'Remote' } };

    expect(discoverSessions().sessions).toHaveLength(0);
  });
});
