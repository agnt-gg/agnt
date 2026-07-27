/**
 * Unit tests for the Electron local UI static server + reverse proxy.
 *
 * Covers:
 *   - missing dist / index errors
 *   - static file serving + SPA fallback
 *   - path-escape protection
 *   - /api and /socket.io proxy to a mock remote
 *   - proxy 502 when remote is down
 *   - fixed vs ephemeral ports
 *   - resolveFrontendDistPath candidates
 *
 * Run: npx vitest run tests/unit/electron-local-ui-server.test.js
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';

import {
  startLocalUiServer,
  resolveFrontendDistPath,
  DEFAULT_LOCAL_UI_PORT,
} from '../../electron/local-ui-server.js';

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeFakeDist() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-ui-dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>AGNT UI</title><div id="app">ok</div>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log("hi")');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'style.css'), 'body{color:red}');
  return dir;
}

function fetchText(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || 'GET', headers: options.headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe('DEFAULT_LOCAL_UI_PORT', () => {
  it('is the stable desktop UI port 19333', () => {
    expect(DEFAULT_LOCAL_UI_PORT).toBe(19333);
  });
});

describe('startLocalUiServer — validation', () => {
  it('rejects when dist dir is missing', async () => {
    await expect(startLocalUiServer('/tmp/agnt-no-such-dist-xyz', { port: 0 })).rejects.toThrow(/dist not found/i);
  });

  it('rejects when index.html is missing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-ui-empty-'));
    try {
      await expect(startLocalUiServer(dir, { port: 0 })).rejects.toThrow(/index\.html/i);
    } finally {
      rmrf(dir);
    }
  });

  it('rejects invalid proxyTarget', async () => {
    const dist = makeFakeDist();
    try {
      await expect(startLocalUiServer(dist, { port: 0, proxyTarget: 'not a url' })).rejects.toThrow(/Invalid proxy target/i);
    } finally {
      rmrf(dist);
    }
  });
});

describe('startLocalUiServer — static', () => {
  let dist;
  let handle;

  beforeAll(async () => {
    dist = makeFakeDist();
    handle = await startLocalUiServer(dist, { port: 0 });
  });

  afterAll(async () => {
    await new Promise((r) => handle.server.close(r));
    rmrf(dist);
  });

  it('serves index.html at /', async () => {
    const res = await fetchText(`${handle.origin}/`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('AGNT UI');
  });

  it('serves static assets with correct content-type', async () => {
    const js = await fetchText(`${handle.origin}/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);
    expect(js.body).toContain('console.log');

    const css = await fetchText(`${handle.origin}/assets/style.css`);
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);
  });

  it('SPA-fallbacks unknown routes to index.html', async () => {
    const res = await fetchText(`${handle.origin}/settings/connection`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('AGNT UI');
  });

  it('blocks path traversal outside dist', async () => {
    const res = await fetchText(`${handle.origin}/../../../../etc/passwd`);
    // Either 403 Forbidden or SPA fallback to index (both avoid leaking files)
    if (res.status === 403) {
      expect(res.body).toMatch(/Forbidden/i);
    } else {
      expect(res.status).toBe(200);
      expect(res.body).toContain('AGNT UI');
      expect(res.body).not.toMatch(/^root:/);
    }
  });

  it('uses an ephemeral port when port is 0', () => {
    expect(handle.port).toBeGreaterThan(0);
    expect(handle.origin).toBe(`http://127.0.0.1:${handle.port}`);
  });
});

describe('startLocalUiServer — proxy', () => {
  let dist;
  let remote;
  let remotePort;
  let remoteHits;
  let handle;

  beforeAll(async () => {
    dist = makeFakeDist();
    remoteHits = [];

    remote = http.createServer((req, res) => {
      remoteHits.push({ method: req.method, url: req.url });
      if (req.url === '/api/health' || req.url?.startsWith('/api/health')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', via: 'remote' }));
        return;
      }
      if (req.url?.startsWith('/api/agents')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ id: 1, name: 'Test Agent' }]));
        return;
      }
      if (req.url?.startsWith('/socket.io/')) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('socket-io-ok');
        return;
      }
      res.writeHead(404);
      res.end('remote-miss');
    });

    await new Promise((r) => remote.listen(0, '127.0.0.1', r));
    remotePort = remote.address().port;

    handle = await startLocalUiServer(dist, {
      port: 0,
      proxyTarget: `http://127.0.0.1:${remotePort}`,
    });
  });

  afterAll(async () => {
    await new Promise((r) => handle.server.close(r));
    await new Promise((r) => remote.close(r));
    rmrf(dist);
  });

  beforeEach(() => {
    remoteHits.length = 0;
  });

  it('proxies /api/health to the remote backend', async () => {
    const res = await fetchText(`${handle.origin}/api/health`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: 'ok', via: 'remote' });
    expect(remoteHits.some((h) => h.url?.startsWith('/api/health'))).toBe(true);
  });

  it('proxies /api/agents (JSON)', async () => {
    const res = await fetchText(`${handle.origin}/api/agents`);
    expect(res.status).toBe(200);
    const data = JSON.parse(res.body);
    expect(data[0].name).toBe('Test Agent');
  });

  it('proxies /socket.io/ polling path', async () => {
    const res = await fetchText(`${handle.origin}/socket.io/?EIO=4&transport=polling`);
    expect(res.status).toBe(200);
    expect(res.body).toBe('socket-io-ok');
  });

  it('still serves local UI for non-api paths while proxy is enabled', async () => {
    const res = await fetchText(`${handle.origin}/`);
    expect(res.status).toBe(200);
    expect(res.body).toContain('AGNT UI');
    expect(remoteHits.length).toBe(0);
  });

  it('returns 502 when proxy target is unreachable', async () => {
    const deadDist = makeFakeDist();
    let deadHandle;
    try {
      deadHandle = await startLocalUiServer(deadDist, {
        port: 0,
        proxyTarget: 'http://127.0.0.1:1',
      });
      const res = await fetchText(`${deadHandle.origin}/api/health`);
      expect(res.status).toBe(502);
      expect(res.body).toMatch(/Proxy|failed|error/i);
    } finally {
      if (deadHandle) await new Promise((r) => deadHandle.server.close(r));
      rmrf(deadDist);
    }
  });
});

describe('startLocalUiServer — port fallback', () => {
  it('falls back when preferred port is busy', async () => {
    const dist = makeFakeDist();
    const blocker = http.createServer((_req, res) => res.end('busy'));
    let ui;
    try {
      await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
      const busyPort = blocker.address().port;

      ui = await startLocalUiServer(dist, { port: busyPort });
      // Should not fail; either same port stolen (unlikely) or ephemeral fallback
      expect(ui.port).toBeGreaterThan(0);
      const res = await fetchText(`${ui.origin}/`);
      expect(res.status).toBe(200);
      expect(res.body).toContain('AGNT UI');
    } finally {
      if (ui) await new Promise((r) => ui.server.close(r));
      await new Promise((r) => blocker.close(r));
      rmrf(dist);
    }
  });
});

describe('resolveFrontendDistPath', () => {
  let tmp;
  let withIndex;
  let withoutIndex;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-resolve-'));
    withIndex = path.join(tmp, 'frontend', 'dist');
    fs.mkdirSync(withIndex, { recursive: true });
    fs.writeFileSync(path.join(withIndex, 'index.html'), '<html></html>');

    withoutIndex = path.join(tmp, 'empty', 'frontend', 'dist');
    fs.mkdirSync(withoutIndex, { recursive: true });
  });

  afterAll(() => {
    rmrf(tmp);
  });

  it('returns candidate that contains index.html', () => {
    const found = resolveFrontendDistPath({
      app: { isPackaged: false },
      dirname: tmp,
    });
    expect(found).toBe(withIndex);
  });

  it('falls back to first candidate when none have index.html', () => {
    const base = path.join(tmp, 'empty');
    const found = resolveFrontendDistPath({
      app: { isPackaged: false },
      dirname: base,
    });
    expect(found).toBe(path.join(base, 'frontend', 'dist'));
  });

  it('checks packaged candidates when app.isPackaged', () => {
    const resources = path.join(tmp, 'resources');
    const asarDist = path.join(resources, 'app.asar', 'frontend', 'dist');
    fs.mkdirSync(asarDist, { recursive: true });
    fs.writeFileSync(path.join(asarDist, 'index.html'), '<html>packaged</html>');

    const prev = process.resourcesPath;
    process.resourcesPath = resources;
    try {
      const found = resolveFrontendDistPath({
        app: { isPackaged: true },
        dirname: path.join(tmp, 'nope'),
      });
      expect(found).toBe(asarDist);
    } finally {
      if (prev === undefined) delete process.resourcesPath;
      else process.resourcesPath = prev;
    }
  });
});
