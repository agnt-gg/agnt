import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { openCdpBridge, readBridgedEndpoint, clearStaleProfileLocks } from './hostedCdpBridge.js';

/**
 * Bravo, 2026-10-31: the built-in browser never started on a hosted instance ("never reported a
 * debugging endpoint within 30 seconds"). Chromium ran in the tool sandbox's own network namespace, so
 * its debugging port was unreachable from the server, and its profile was outside the sandbox.
 * The bridge carries the debugging connection over a Unix socket in a folder both sides mount.
 */

// A stand-in for "Chromium behind sandbox-network.cjs": an HTTP + upgrade server on a local socket.
const socketPath = process.platform === 'win32'
  ? `\\\\.\\pipe\\agnt-cdp-test-${process.pid}-${Date.now()}`
  : path.join(os.tmpdir(), `agnt-cdp-test-${process.pid}-${Date.now()}.sock`);
let browser; let bridge;

afterEach(() => { bridge?.close(); browser?.close(); bridge = browser = null; });

function fakeBrowser(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(socketPath, () => resolve(server));
  });
}

describe('hosted CDP bridge', () => {
  it('serves the browser\'s endpoint on a server-side loopback port, rewritten to that port', async () => {
    browser = await fakeBrowser((req, res) => {
      expect(req.url).toBe('/json/version');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/39325ed9-d99d-4306-9b8a-f163d448fecc' }));
    });
    bridge = await openCdpBridge(socketPath);
    expect(bridge.port).toBeGreaterThan(0);
    expect(await readBridgedEndpoint(bridge.port)).toBe(`ws://127.0.0.1:${bridge.port}/devtools/browser/39325ed9-d99d-4306-9b8a-f163d448fecc`);
  });

  it('is not ready while the browser is not answering, and refuses anything but a browser endpoint', async () => {
    bridge = await openCdpBridge(socketPath);
    expect(await readBridgedEndpoint(bridge.port, { timeoutMs: 500 })).toBeNull();
    bridge.close();
    browser = await fakeBrowser((_req, res) => res.end(JSON.stringify({ webSocketDebuggerUrl: 'ws://evil.example/devtools/browser/x?y' })));
    bridge = await openCdpBridge(socketPath);
    expect(await readBridgedEndpoint(bridge.port)).toBeNull();
  });

  it('close drops live connections and stops listening', async () => {
    browser = await fakeBrowser(() => { /* hold the request open */ });
    bridge = await openCdpBridge(socketPath);
    const { port } = bridge;
    const pending = new Promise((resolve) => { http.get({ host: '127.0.0.1', port, path: '/json/version' }).on('error', () => resolve('dropped')); });
    await new Promise((r) => setTimeout(r, 100));
    bridge.close(); bridge = null;
    expect(await pending).toBe('dropped');
    expect(await readBridgedEndpoint(port, { timeoutMs: 500 })).toBeNull();
  });

  it('clears a previous browser\'s profile locks and leaves the profile itself alone', () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-profile-'));
    for (const name of ['SingletonLock', 'SingletonCookie', 'DevToolsActivePort', 'Local State']) fs.writeFileSync(path.join(profile, name), 'x');
    clearStaleProfileLocks(profile);
    expect(fs.readdirSync(profile)).toEqual(['Local State']);
    fs.rmSync(profile, { recursive: true, force: true });
  });
});
