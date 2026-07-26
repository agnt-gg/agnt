/**
 * Unit tests for GrokBuildAuthManager (filesystem + env; no live network).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('GrokBuildAuthManager', () => {
  let tmpHome;
  let prevGrokHome;
  let prevGrokBin;
  let prevXaiKey;
  let manager;

  beforeEach(async () => {
    vi.resetModules();
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-grok-auth-'));
    prevGrokHome = process.env.GROK_HOME;
    prevGrokBin = process.env.GROK_BIN;
    prevXaiKey = process.env.XAI_API_KEY;
    process.env.GROK_HOME = tmpHome;
    delete process.env.XAI_API_KEY;
    // Point bin at a non-existent path so checkApiUsable doesn't shell real grok
    process.env.GROK_BIN = path.join(tmpHome, 'no-such-grok-bin');

    manager = (await import('./GrokBuildAuthManager.js')).default;
    // clear TTL cache between tests
    manager.apiCheckCache = null;
  });

  afterEach(() => {
    if (prevGrokHome === undefined) delete process.env.GROK_HOME;
    else process.env.GROK_HOME = prevGrokHome;
    if (prevGrokBin === undefined) delete process.env.GROK_BIN;
    else process.env.GROK_BIN = prevGrokBin;
    if (prevXaiKey === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prevXaiKey;
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('returns available:false when auth.json missing and no env key', async () => {
    const status = await manager.checkApiUsable({ forceRefresh: true });
    expect(status.available).toBe(false);
    expect(status.apiUsable).toBe(false);
    expect(status.source).toBeNull();
  });

  it('getAccessToken prefers XAI_API_KEY env over file', async () => {
    process.env.XAI_API_KEY = 'xai-test-key-123';
    const authPath = path.join(tmpHome, 'auth.json');
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        'https://auth.x.ai::client': {
          key: 'file-token-should-lose',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          refresh_token: 'r',
          email: 'a@b.c',
          auth_mode: 'oidc',
        },
      })
    );
    expect(manager.getAccessToken()).toBe('xai-test-key-123');
  });

  it('reads OIDC key from auth.json when env absent', () => {
    const authPath = path.join(tmpHome, 'auth.json');
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        'https://auth.x.ai::client': {
          key: 'oidc-bearer-from-file',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          refresh_token: 'r',
          email: 'user@example.com',
          auth_mode: 'oidc',
        },
      })
    );
    expect(manager.getAccessToken()).toBe('oidc-bearer-from-file');
    const exp = manager.getTokenExpiry();
    expect(exp.expired).toBe(false);
    expect(exp.email).toBe('user@example.com');
    expect(exp.hasRefreshToken).toBe(true);
  });

  it('detects expired OIDC entry', () => {
    const authPath = path.join(tmpHome, 'auth.json');
    fs.writeFileSync(
      authPath,
      JSON.stringify({
        'https://auth.x.ai::client': {
          key: 'old-token',
          expires_at: new Date(Date.now() - 3600_000).toISOString(),
          refresh_token: 'r',
          email: 'user@example.com',
          auth_mode: 'oidc',
        },
      })
    );
    const exp = manager.getTokenExpiry();
    expect(exp.expired).toBe(true);
    expect(manager.getAccessToken()).toBe('old-token');
  });

  it('with env key only, checkApiUsable returns available when CLI probe fails', async () => {
    process.env.XAI_API_KEY = 'xai-only-env';
    // no auth.json, broken bin — env fallback should still mark usable
    const status = await manager.checkApiUsable({ forceRefresh: true });
    expect(status.available).toBe(true);
    expect(status.apiUsable).toBe(true);
    expect(status.source).toBe('env-xai-api-key');
  });
});
