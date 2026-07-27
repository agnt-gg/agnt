/**
 * Unit tests for hybrid / external-backend connection config.
 *
 * Covers pure resolution logic used by Electron main + Settings IPC:
 *   - normalize / validate URLs
 *   - read/write desktop-connection.json
 *   - env vs file vs default precedence
 *   - invalid external URL falls back to local
 *   - health probe against a tiny local server
 *
 * Run: npm test
 *   or: npx vitest run tests/unit/electron-connection-config.test.js
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

import {
  connectionConfigPath,
  readStoredConnectionConfig,
  writeStoredConnectionConfig,
  normalizeBackendUrl,
  validateBackendUrl,
  resolveConnectionConfig,
  probeBackendHealth,
  waitUntilHealthy,
} from '../../electron/connection-config.js';

function makeTempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-conn-test-'));
}

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('normalizeBackendUrl', () => {
  it('returns empty for nullish / non-string', () => {
    expect(normalizeBackendUrl('')).toBe('');
    expect(normalizeBackendUrl(null)).toBe('');
    expect(normalizeBackendUrl(undefined)).toBe('');
    expect(normalizeBackendUrl(42)).toBe('');
  });

  it('trims whitespace and trailing slashes', () => {
    expect(normalizeBackendUrl('  http://host:3333/  ')).toBe('http://host:3333');
    expect(normalizeBackendUrl('http://host:3333///')).toBe('http://host:3333');
  });

  it('strips a trailing /api suffix', () => {
    expect(normalizeBackendUrl('http://10.0.0.5:3333/api')).toBe('http://10.0.0.5:3333');
    expect(normalizeBackendUrl('http://10.0.0.5:3333/api/')).toBe('http://10.0.0.5:3333');
  });

  it('does not strip /api mid-path', () => {
    expect(normalizeBackendUrl('http://host/api/v1')).toBe('http://host/api/v1');
  });
});

describe('validateBackendUrl', () => {
  it('rejects empty', () => {
    const r = validateBackendUrl('');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/required/i);
  });

  it('rejects non-absolute garbage', () => {
    const r = validateBackendUrl('not a url');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/valid URL/i);
  });

  it('rejects non-http protocols', () => {
    const r = validateBackendUrl('ftp://files.example.com');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/http/i);
  });

  it('accepts http and https and returns cleaned', () => {
    const httpR = validateBackendUrl('http://192.168.1.10:3333/api/');
    expect(httpR.ok).toBe(true);
    expect(httpR.cleaned).toBe('http://192.168.1.10:3333');

    const httpsR = validateBackendUrl('https://agnt.example.com');
    expect(httpsR.ok).toBe(true);
    expect(httpsR.cleaned).toBe('https://agnt.example.com');
  });
});

describe('read/write desktop-connection.json', () => {
  let userData;

  beforeAll(() => {
    userData = makeTempUserData();
  });

  afterAll(() => {
    rmrf(userData);
  });

  it('defaults when file is missing', () => {
    const stored = readStoredConnectionConfig(userData);
    expect(stored).toEqual({ useExternalBackend: false, backendUrl: '' });
    expect(connectionConfigPath(userData)).toBe(path.join(userData, 'desktop-connection.json'));
  });

  it('round-trips config and strips trailing slash on write', () => {
    const written = writeStoredConnectionConfig(userData, {
      useExternalBackend: true,
      backendUrl: 'http://server:3333/',
    });
    expect(written.useExternalBackend).toBe(true);
    expect(written.backendUrl).toBe('http://server:3333');

    const stored = readStoredConnectionConfig(userData);
    expect(stored.useExternalBackend).toBe(true);
    expect(stored.backendUrl).toBe('http://server:3333');
  });

  it('recovers from corrupt JSON', () => {
    fs.writeFileSync(connectionConfigPath(userData), '{not-json', 'utf8');
    const stored = readStoredConnectionConfig(userData);
    expect(stored).toEqual({ useExternalBackend: false, backendUrl: '' });
  });
});

describe('resolveConnectionConfig', () => {
  let userData;

  beforeAll(() => {
    userData = makeTempUserData();
  });

  afterAll(() => {
    rmrf(userData);
  });

  it('defaults to local backend on 127.0.0.1:3333', () => {
    const r = resolveConnectionConfig({ userDataPath: userData, env: {} });
    expect(r.useExternalBackend).toBe(false);
    expect(r.backendUrl).toBe('http://127.0.0.1:3333');
    expect(r.loadUrl).toBe('http://127.0.0.1:3333');
    expect(r.healthUrl).toBe('http://127.0.0.1:3333/api/health');
    expect(r.source).toBe('default');
    expect(r.envOverrides).toBe(false);
  });

  it('respects PORT for the local default', () => {
    const r = resolveConnectionConfig({ userDataPath: userData, env: { PORT: '4444' } });
    expect(r.backendUrl).toBe('http://127.0.0.1:4444');
    expect(r.healthUrl).toBe('http://127.0.0.1:4444/api/health');
  });

  it('uses stored file when external is enabled', () => {
    writeStoredConnectionConfig(userData, {
      useExternalBackend: true,
      backendUrl: 'http://10.0.0.9:3333/api',
    });
    const r = resolveConnectionConfig({ userDataPath: userData, env: {} });
    expect(r.useExternalBackend).toBe(true);
    expect(r.backendUrl).toBe('http://10.0.0.9:3333');
    expect(r.healthUrl).toBe('http://10.0.0.9:3333/api/health');
    expect(r.source).toBe('file');
    expect(r.envOverrides).toBe(false);
  });

  it('env USE_EXTERNAL_BACKEND + BACKEND_URL override the file', () => {
    writeStoredConnectionConfig(userData, {
      useExternalBackend: true,
      backendUrl: 'http://from-file:3333',
    });
    const r = resolveConnectionConfig({
      userDataPath: userData,
      env: {
        USE_EXTERNAL_BACKEND: 'true',
        BACKEND_URL: 'http://from-env:9999/api',
      },
    });
    expect(r.useExternalBackend).toBe(true);
    expect(r.backendUrl).toBe('http://from-env:9999');
    expect(r.source).toBe('env');
    expect(r.envOverrides).toBe(true);
    expect(r.stored.backendUrl).toBe('http://from-file:3333');
  });

  it('BACKEND_URL alone enables external mode from env source', () => {
    writeStoredConnectionConfig(userData, {
      useExternalBackend: false,
      backendUrl: '',
    });
    const r = resolveConnectionConfig({
      userDataPath: userData,
      env: { BACKEND_URL: 'https://remote.example.com' },
    });
    expect(r.useExternalBackend).toBe(true);
    expect(r.backendUrl).toBe('https://remote.example.com');
    expect(r.source).toBe('env');
  });

  it('USE_EXTERNAL_BACKEND=false forces local even if file says external', () => {
    writeStoredConnectionConfig(userData, {
      useExternalBackend: true,
      backendUrl: 'http://should-not-use:3333',
    });
    const r = resolveConnectionConfig({
      userDataPath: userData,
      env: { USE_EXTERNAL_BACKEND: 'false' },
    });
    expect(r.useExternalBackend).toBe(false);
    expect(r.backendUrl).toBe('http://127.0.0.1:3333');
    expect(r.source).toBe('env');
  });

  it('falls back to local when external URL is invalid', () => {
    writeStoredConnectionConfig(userData, {
      useExternalBackend: true,
      backendUrl: 'not-a-url',
    });
    const r = resolveConnectionConfig({ userDataPath: userData, env: {} });
    expect(r.useExternalBackend).toBe(false);
    expect(r.backendUrl).toBe('http://127.0.0.1:3333');
    expect(r.source).toBe('default');
  });

  it('treats useExternalBackend false with only a stored URL as local', () => {
    writeStoredConnectionConfig(userData, {
      useExternalBackend: false,
      backendUrl: 'http://ignored-when-local:3333',
    });
    const r = resolveConnectionConfig({ userDataPath: userData, env: {} });
    expect(r.useExternalBackend).toBe(false);
    expect(r.backendUrl).toBe('http://127.0.0.1:3333');
    expect(r.source).toBe('file');
  });
});

describe('probeBackendHealth', () => {
  let server;
  let baseUrl;
  let statusCode = 200;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('returns ok for a healthy backend', async () => {
    statusCode = 200;
    const result = await probeBackendHealth(baseUrl, 3000);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(typeof result.latencyMs).toBe('number');
  });

  it('returns not ok for non-200 health', async () => {
    statusCode = 503;
    const result = await probeBackendHealth(baseUrl, 3000);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toMatch(/503/);
  });

  it('rejects invalid URLs without opening a socket', async () => {
    const result = await probeBackendHealth('ftp://nope', 1000);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/http/i);
  });

  it('reports connection errors for closed ports', async () => {
    const result = await probeBackendHealth('http://127.0.0.1:1', 2000);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('waitUntilHealthy', () => {
  let server;
  let baseUrl;
  let hits;

  beforeAll(async () => {
    hits = 0;
    server = http.createServer((_req, res) => {
      hits += 1;
      // Fail first two probes, then succeed
      if (hits < 3) {
        res.writeHead(503);
        res.end('not yet');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it('retries until health succeeds', async () => {
    hits = 0;
    const result = await waitUntilHealthy(baseUrl, {
      maxAttempts: 5,
      intervalMs: 10,
      requestTimeoutMs: 2000,
    });
    expect(result.ok).toBe(true);
    expect(result.attempts).toBeGreaterThanOrEqual(3);
  });

  it('stops after maxAttempts', async () => {
    hits = 0;
    // Force permanent 503 by restarting logic: first request after reset is 503
    // Keep server always 503 for this test via a separate server
    let alwaysDown;
    alwaysDown = http.createServer((_req, res) => {
      res.writeHead(503);
      res.end('down');
    });
    await new Promise((r) => alwaysDown.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${alwaysDown.address().port}`;
    try {
      const result = await waitUntilHealthy(url, {
        maxAttempts: 3,
        intervalMs: 5,
        requestTimeoutMs: 1000,
      });
      expect(result.ok).toBe(false);
      expect(result.attempts).toBe(3);
    } finally {
      await new Promise((r) => alwaysDown.close(r));
    }
  });
});
