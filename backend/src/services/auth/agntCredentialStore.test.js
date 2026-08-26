/**
 * agntCredentialStore — AGNT's own credential store.
 *
 * Runs against the real filesystem: tests/setup/isolate-data-dir.mjs already
 * points PathManager at a throwaway temp dir, so a real read/write/rename cycle
 * is both safe and a far stronger test than a mocked fs would be.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  readCredential, writeCredential, clearCredential, hasCredential,
  getCredentialPath, getStoreDir,
} from './agntCredentialStore.js';

/**
 * A provider id no real manager uses.
 *
 * This suite originally used 'claude-code' — the same slot ClaudeCodeAuthManager
 * .test.js writes. When vitest puts both files in one worker process they share
 * a PathManager root (the isolation setup redirects once PER PROCESS, not per
 * file), so this suite's beforeEach cleanup deleted a credential the Claude
 * suite had just written. It failed roughly one run in three, and only when
 * enough other files were scheduled alongside them.
 *
 * The store is provider-agnostic, so testing it against a real provider's slot
 * bought nothing and cost a race.
 */
const PROVIDER = 'store-fixture-provider';

beforeEach(() => clearCredential(PROVIDER));
afterEach(() => clearCredential(PROVIDER));

describe('round trip', () => {
  it('writes then reads a credential', () => {
    writeCredential(PROVIDER, { claudeAiOauth: { accessToken: 'sk-ant-oat-1' } });
    expect(readCredential(PROVIDER).claudeAiOauth.accessToken).toBe('sk-ant-oat-1');
  });

  it('stamps updatedAt so a stale credential is diagnosable', () => {
    writeCredential(PROVIDER, { claudeAiOauth: { accessToken: 'x' } });
    expect(Date.parse(readCredential(PROVIDER).updatedAt)).not.toBeNaN();
  });

  it('reports absence as null, not as a throw', () => {
    expect(readCredential(PROVIDER)).toBeNull();
    expect(hasCredential(PROVIDER)).toBe(false);
  });

  it('overwrites rather than merging — the store holds one credential', () => {
    writeCredential(PROVIDER, { claudeAiOauth: { accessToken: 'first' }, extra: 1 });
    writeCredential(PROVIDER, { claudeAiOauth: { accessToken: 'second' } });
    const stored = readCredential(PROVIDER);
    expect(stored.claudeAiOauth.accessToken).toBe('second');
    expect(stored.extra).toBeUndefined();
  });

  it('clearCredential reports whether anything was removed', () => {
    expect(clearCredential(PROVIDER)).toBe(false);
    writeCredential(PROVIDER, { claudeAiOauth: { accessToken: 'x' } });
    expect(clearCredential(PROVIDER)).toBe(true);
    expect(readCredential(PROVIDER)).toBeNull();
  });
});

describe('resilience', () => {
  it('treats a corrupt file as "no credential" rather than failing the provider', () => {
    // A truncated write must not lock the user out — the next cascade tier is
    // a perfectly good answer.
    writeCredential(PROVIDER, { claudeAiOauth: { accessToken: 'x' } });
    fs.writeFileSync(getCredentialPath(PROVIDER), '{ not json');
    expect(readCredential(PROVIDER)).toBeNull();
  });

  it('treats a JSON scalar as no credential', () => {
    writeCredential(PROVIDER, { claudeAiOauth: { accessToken: 'x' } });
    fs.writeFileSync(getCredentialPath(PROVIDER), '"just a string"');
    expect(readCredential(PROVIDER)).toBeNull();
  });

  it('creates the store directory on first write', () => {
    fs.rmSync(getStoreDir(), { recursive: true, force: true });
    writeCredential(PROVIDER, { claudeAiOauth: { accessToken: 'x' } });
    expect(fs.existsSync(getCredentialPath(PROVIDER))).toBe(true);
  });

  it('leaves no temp file behind — the rename must complete', () => {
    writeCredential(PROVIDER, { claudeAiOauth: { accessToken: 'x' } });
    const leftovers = fs.readdirSync(getStoreDir()).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });
});

describe('path safety', () => {
  it.each(['../escape', 'a/b', '..', '', 'x\\y'])('rejects providerId %j', (bad) => {
    expect(() => getCredentialPath(bad)).toThrow();
  });

  it('keeps the credential inside the store directory', () => {
    const credPath = getCredentialPath(PROVIDER);
    expect(path.dirname(credPath)).toBe(getStoreDir());
  });

  it('reading with a hostile providerId returns null instead of throwing', () => {
    expect(readCredential('../../etc/passwd')).toBeNull();
    expect(clearCredential('../../etc/passwd')).toBe(false);
  });
});

describe('permissions', () => {
  it.runIf(process.platform !== 'win32')('writes 0600 — a credential must not be world-readable', () => {
    writeCredential(PROVIDER, { claudeAiOauth: { accessToken: 'x' } });
    const mode = fs.statSync(getCredentialPath(PROVIDER)).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
