import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveConnection,
  readConfig,
  writeConfig,
  normalizeRemoteUrl,
  isPlaintextRemote,
  configPath,
} from './connectionConfig.js';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-conn-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('normalizeRemoteUrl', () => {
  it('accepts a plain http origin', () => {
    expect(normalizeRemoteUrl('http://192.168.1.50:3333')).toEqual({ ok: true, url: 'http://192.168.1.50:3333' });
  });

  it('accepts https (AGNT Cloud)', () => {
    expect(normalizeRemoteUrl('https://mine.agnt.cloud')).toEqual({ ok: true, url: 'https://mine.agnt.cloud' });
  });

  it('assumes http for a bare host:port — the most likely human input', () => {
    expect(normalizeRemoteUrl('192.168.1.50:3333')).toEqual({ ok: true, url: 'http://192.168.1.50:3333' });
    expect(normalizeRemoteUrl('homelab:3333')).toEqual({ ok: true, url: 'http://homelab:3333' });
  });

  it('reduces to the ORIGIN — a stray path would corrupt every API route', () => {
    expect(normalizeRemoteUrl('http://box:3333/chat?x=1#frag').url).toBe('http://box:3333');
    expect(normalizeRemoteUrl('http://box:3333/').url).toBe('http://box:3333');
  });

  it('trims surrounding whitespace from a pasted URL', () => {
    expect(normalizeRemoteUrl('  http://box:3333  ').url).toBe('http://box:3333');
  });

  // What matters is that these never become a connection target. The exact
  // rejection reason is an implementation detail: a value carrying an explicit
  // `scheme://` is rejected on protocol, while `javascript:alert(1)` has no
  // `://` at all, so it takes the scheme-less path and is rejected as
  // malformed. Asserting the message instead of the outcome made this test
  // fail on a change that did not weaken the guarantee at all.
  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ws://box:3333',
    'ftp://box:21',
  ])('refuses %s as a connection target', (input) => {
    expect(normalizeRemoteUrl(input).ok).toBe(false);
  });

  it('names the protocol when one was explicitly given', () => {
    expect(normalizeRemoteUrl('ws://box:3333').reason).toContain('unsupported protocol');
  });

  it.each([null, undefined, '', '   ', 42, {}])('rejects the junk value %s', (v) => {
    expect(normalizeRemoteUrl(v).ok).toBe(false);
  });
});

describe('isPlaintextRemote', () => {
  it('flags http to a LAN host', () => {
    expect(isPlaintextRemote('http://192.168.1.50:3333')).toBe(true);
  });
  it('does not flag https', () => {
    expect(isPlaintextRemote('https://mine.agnt.cloud')).toBe(false);
  });
  it('does not flag loopback', () => {
    expect(isPlaintextRemote('http://localhost:3333')).toBe(false);
    expect(isPlaintextRemote('http://127.0.0.1:3333')).toBe(false);
  });
});

describe('resolveConnection — the blast-radius contract', () => {
  it('resolves to LOCAL when nothing is configured', () => {
    expect(resolveConnection({ env: {}, userDataPath: dir })).toEqual({
      mode: 'local',
      url: null,
      source: 'default',
    });
  });

  it('resolves to LOCAL when the config file does not exist at all', () => {
    const missing = path.join(dir, 'nope', 'deeper');
    expect(resolveConnection({ env: {}, userDataPath: missing }).mode).toBe('local');
  });

  it('reads a persisted remote choice', () => {
    writeConfig(dir, { mode: 'remote', url: 'http://192.168.1.50:3333' });
    expect(resolveConnection({ env: {}, userDataPath: dir })).toEqual({
      mode: 'remote',
      url: 'http://192.168.1.50:3333',
      source: 'file',
    });
  });

  it('lets AGNT_REMOTE_URL override the persisted file', () => {
    writeConfig(dir, { mode: 'remote', url: 'http://from-file:3333' });
    const out = resolveConnection({ env: { AGNT_REMOTE_URL: 'http://from-env:3333' }, userDataPath: dir });
    expect(out).toEqual({ mode: 'remote', url: 'http://from-env:3333', source: 'env' });
  });

  it('ignores an empty env var rather than treating it as "remote"', () => {
    writeConfig(dir, { mode: 'remote', url: 'http://from-file:3333' });
    expect(resolveConnection({ env: { AGNT_REMOTE_URL: '   ' }, userDataPath: dir }).source).toBe('file');
  });

  it('degrades to LOCAL and reports why when the env var is malformed', () => {
    const out = resolveConnection({ env: { AGNT_REMOTE_URL: 'file:///etc/passwd' }, userDataPath: dir });
    expect(out.mode).toBe('local');
    expect(out.invalid).toMatch(/AGNT_REMOTE_URL rejected/);
  });

  it('degrades to LOCAL on a corrupt config file instead of throwing', () => {
    fs.writeFileSync(configPath(dir), '{ not json');
    expect(() => resolveConnection({ env: {}, userDataPath: dir })).not.toThrow();
    expect(resolveConnection({ env: {}, userDataPath: dir }).mode).toBe('local');
  });

  it('degrades to LOCAL when the saved URL is no longer valid', () => {
    fs.writeFileSync(configPath(dir), JSON.stringify({ mode: 'remote', url: 'file:///x' }));
    const out = resolveConnection({ env: {}, userDataPath: dir });
    expect(out.mode).toBe('local');
    expect(out.invalid).toMatch(/saved URL rejected/);
  });

  it('treats an unknown mode as local', () => {
    fs.writeFileSync(configPath(dir), JSON.stringify({ mode: 'banana', url: 'http://x:1' }));
    expect(resolveConnection({ env: {}, userDataPath: dir }).mode).toBe('local');
  });
});

describe('writeConfig', () => {
  it('round-trips a remote choice', () => {
    const out = writeConfig(dir, { mode: 'remote', url: '192.168.1.50:3333' });
    expect(out.ok).toBe(true);
    expect(readConfig(dir)).toEqual({ mode: 'remote', url: 'http://192.168.1.50:3333', source: 'file' });
  });

  it('switching back to local persists and resolves to local', () => {
    writeConfig(dir, { mode: 'remote', url: 'http://box:3333' });
    writeConfig(dir, { mode: 'local' });
    expect(readConfig(dir).mode).toBe('local');
  });

  it('refuses an invalid URL and leaves the previous config intact', () => {
    writeConfig(dir, { mode: 'remote', url: 'http://good:3333' });
    const out = writeConfig(dir, { mode: 'remote', url: 'file:///etc/passwd' });
    expect(out.ok).toBe(false);
    expect(readConfig(dir).url).toBe('http://good:3333');
  });

  it('refuses an unknown mode', () => {
    expect(writeConfig(dir, { mode: 'banana' }).ok).toBe(false);
  });

  it('leaves no .tmp file behind (atomic rename)', () => {
    writeConfig(dir, { mode: 'remote', url: 'http://box:3333' });
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });
});
