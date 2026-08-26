/**
 * CursorCliAuthManager.describeCredential — discovery reporting only.
 *
 * Cursor is the one provider with no readable token, so its discovery answer is
 * built from evidence of varying strength. These tests pin which evidence is
 * allowed to count, and — more importantly — which is not: the existence of
 * ~/.cursor must never read as "connected", because that directory appears the
 * first time the CLI runs, signed in or not.
 *
 * The auth path itself is deliberately untested here because it is deliberately
 * untouched: getAccessToken() still gates its sentinel on a warm probe alone.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import realOs from 'os';
import path from 'path';

const h = vi.hoisted(() => ({ home: '' }));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal();
  const patched = { ...actual.default, homedir: () => h.home };
  return { ...actual, default: patched, homedir: patched.homedir };
});

const { default: manager } = await import('./CursorCliAuthManager.js');

function cursorDir() {
  return path.join(h.home, '.cursor');
}

function writeCliConfig(contents) {
  fs.mkdirSync(cursorDir(), { recursive: true });
  fs.writeFileSync(path.join(cursorDir(), 'cli-config.json'), JSON.stringify(contents, null, 2));
}

beforeEach(() => {
  h.home = fs.mkdtempSync(path.join(realOs.tmpdir(), 'agnt-cursor-'));
  manager.apiCheckCache = null;
});

afterEach(() => {
  manager.apiCheckCache = null;
  fs.rmSync(h.home, { recursive: true, force: true });
});

describe('evidence that must NOT count as connected', () => {
  it('an empty machine reports not connected', () => {
    const described = manager.describeCredential();
    expect(described.connected).toBe(false);
    expect(described.requiresProbe).toBe(true);
  });

  it('~/.cursor existing proves nothing — the CLI creates it on first run', () => {
    fs.mkdirSync(cursorDir(), { recursive: true });
    expect(manager.describeCredential().connected).toBe(false);
  });

  it('a cli-config.json with no authInfo is a signed-OUT CLI', () => {
    writeCliConfig({ version: 1, editor: 'vim', model: 'auto' });
    expect(manager.describeCredential().connected).toBe(false);
  });

  it('an empty authInfo object does not count', () => {
    writeCliConfig({ authInfo: {} });
    expect(manager.describeCredential().connected).toBe(false);
  });

  it('a corrupt cli-config.json reports not connected instead of throwing', () => {
    fs.mkdirSync(cursorDir(), { recursive: true });
    fs.writeFileSync(path.join(cursorDir(), 'cli-config.json'), '{ truncated');
    expect(manager.describeCredential().connected).toBe(false);
  });

  it('authInfo: null does not count', () => {
    writeCliConfig({ authInfo: null });
    expect(manager.describeCredential().connected).toBe(false);
  });
});

describe('the CLI\'s own signed-in marker', () => {
  it('reports connected, names the user, and asks to be confirmed', () => {
    writeCliConfig({ authInfo: { email: 'user@example.com', userId: 1, authId: 'abc' } });

    const described = manager.describeCredential();

    expect(described.connected).toBe(true);
    expect(described.source).toBe('cursor-cli-config');
    expect(described.tier).toBe('vendor-file');
    expect(described.email).toBe('user@example.com');
    expect(described.label).toContain('user@example.com');
    // A marker can outlive its session, so this stays confirmable.
    expect(described.requiresProbe).toBe(true);
  });

  it('accepts an authId without an email', () => {
    writeCliConfig({ authInfo: { authId: 'abc' } });

    const described = manager.describeCredential();

    expect(described.connected).toBe(true);
    expect(described.email).toBeNull();
    expect(described.label).toBe('Cursor CLI signed in');
  });

  it('is never claimed as AGNT\'s own — disconnect cannot revoke it', () => {
    writeCliConfig({ authInfo: { email: 'user@example.com' } });
    expect(manager.describeCredential().ownedByAgnt).toBe(false);
  });
});

describe('a warm probe outranks the file marker', () => {
  it('prefers the confirmed session and stops asking for a probe', () => {
    writeCliConfig({ authInfo: { email: 'stale@example.com' } });
    manager.apiCheckCache = { value: { apiUsable: true, email: 'live@example.com' } };

    const described = manager.describeCredential();

    expect(described.source).toBe('cursor-cli-session');
    expect(described.tier).toBe('cli-probe');
    expect(described.email).toBe('live@example.com');
    expect(described.requiresProbe).toBe(false);
  });

  it('a probe that came back UNUSABLE falls through to the marker rather than overriding it', () => {
    // A failed probe is not proof of signed-out — it can be a missing binary or
    // a network blip. The marker is still the better answer.
    writeCliConfig({ authInfo: { email: 'user@example.com' } });
    manager.apiCheckCache = { value: { apiUsable: false } };

    const described = manager.describeCredential();

    expect(described.connected).toBe(true);
    expect(described.source).toBe('cursor-cli-config');
  });
});

describe('the auth path is untouched by any of this', () => {
  it('getAccessToken stays gated on the warm probe — a file marker cannot mint a session', () => {
    writeCliConfig({ authInfo: { email: 'user@example.com' } });
    expect(manager.describeCredential().connected).toBe(true);
    expect(manager.getAccessToken()).toBeNull();
  });

  it('and returns its sentinel once the probe confirms', () => {
    manager.apiCheckCache = { value: { apiUsable: true } };
    expect(manager.getAccessToken()).toBe('cursor-cli-session');
  });
});
