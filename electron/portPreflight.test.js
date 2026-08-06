/**
 * Behavioural tests for probeBackendOnce — "is an AGNT already on this port?"
 *
 * Real servers on ephemeral ports, no mocks: the whole value of this function
 * is what it concludes about a REAL listener, and the interesting cases are all
 * things a mock would never do (answer 200 with someone else's JSON, accept the
 * connection and then say nothing, stream forever).
 *
 * The distinction it must draw:
 *   AGNT is there            -> alive, with a pid we may signal
 *   something else is there  -> NOT alive, with a reason
 *   nothing is there         -> NOT alive
 *
 * Collapsing the middle case into either of the others is dangerous in both
 * directions: treat a stranger as AGNT and we offer to attach to it (or kill
 * it); treat AGNT as a stranger and we are back to the crash this fixes.
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { probeBackendOnce } from './backendHealth.js';

const open = [];

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  open.push(server);
  return server.address().port;
}

/** A port that accepts TCP and then says nothing at all. */
async function blackHole() {
  const server = net.createServer((socket) => open.push(socket));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  open.push(server);
  return server.address().port;
}

/** A port nothing is listening on. */
async function deadPort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

afterEach(() => {
  for (const h of open.splice(0)) {
    try {
      h.destroy?.();
      h.close?.();
    } catch {
      /* already gone */
    }
  }
});

describe('probeBackendOnce', () => {
  it('recognises AGNT and reports the pid needed to replace it', async () => {
    const port = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', pid: 4242, version: '0.6.5' }));
    });

    expect(await probeBackendOnce({ port })).toEqual({
      alive: true,
      pid: 4242,
      version: '0.6.5',
      reason: null,
    });
  });

  it('still recognises an older AGNT that reports no identity', async () => {
    // Backends predating loopback identity answer a bare { status: 'OK' }.
    // They are still AGNT and still shareable — only "start fresh" is off the
    // table, which is why pid is surfaced as null rather than guessed at.
    const port = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK' }));
    });

    const found = await probeBackendOnce({ port });
    expect(found.alive).toBe(true);
    expect(found.pid).toBeNull();
    expect(found.version).toBeNull();
  });

  it('refuses to claim a stranger that answers 200 is AGNT', async () => {
    // The dangerous false positive: we would offer to kill someone else's
    // process, or attach the user to a server that is not their backend.
    const port = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', service: 'someone-elses-api' }));
    });

    const found = await probeBackendOnce({ port });
    expect(found.alive).toBe(false);
    expect(found.pid).toBeNull();
    expect(found.reason).toMatch(/not AGNT/i);
  });

  it('refuses a 200 that is not even JSON', async () => {
    const port = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html>some other dev server</html>');
    });

    expect((await probeBackendOnce({ port })).alive).toBe(false);
  });

  it('reports a non-200 as not alive, with the status', async () => {
    const port = await listen((req, res) => {
      res.writeHead(503);
      res.end('nope');
    });

    const found = await probeBackendOnce({ port });
    expect(found.alive).toBe(false);
    expect(found.reason).toContain('503');
  });

  it('reports a free port as not alive, fast', async () => {
    // The normal case on every launch. It must cost effectively nothing, or a
    // preflight on the boot path would be a tax on every start.
    const port = await deadPort();
    const started = Date.now();

    expect((await probeBackendOnce({ port })).alive).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('gives up on a port that accepts TCP and never replies', async () => {
    // The shape that produced 366s of dead app in the remote poller. Here it
    // must be bounded by the caller's timeout, not by anything's patience.
    const port = await blackHole();
    const started = Date.now();

    const found = await probeBackendOnce({ port, timeoutMs: 300 });
    expect(found.alive).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('does not buffer an unbounded body from a hostile listener', async () => {
    // Something on this port may be neither AGNT nor friendly. A 4KB cap means
    // it cannot push memory into the main process.
    //
    // The body is a VALID AGNT health response padded past the cap, which is
    // what makes the cap observable: truncated, it fails to parse and the
    // listener is (correctly) not treated as AGNT. Without the cap it parses
    // and we would have swallowed 4MB to reach that conclusion. AGNT's own
    // health body is ~60 bytes, so nothing legitimate is near this.
    const port = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"status":"OK","pid":1,"pad":"');
      const chunk = 'x'.repeat(64 * 1024);
      for (let i = 0; i < 64; i += 1) res.write(chunk); // 4 MB of padding
      res.end('"}');
    });

    const found = await probeBackendOnce({ port, timeoutMs: 5000 });
    expect(found.alive, 'an oversized body was parsed, so it was never capped').toBe(false);
  });

  it('never rejects — the boot path has nowhere to catch', async () => {
    // It is called on the way to forking the backend. A throw there would be
    // an unhandled rejection in the Electron main process at startup.
    await expect(probeBackendOnce({ port: 0 })).resolves.toMatchObject({ alive: false });
    await expect(probeBackendOnce({ port: 'not-a-port' })).resolves.toMatchObject({ alive: false });
  });

  it('resolves exactly once even when the socket errors after the reply', async () => {
    const port = await listen((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'OK', pid: 7 }));
      // Yank the connection immediately after answering.
      setImmediate(() => res.socket?.destroy());
    });

    const found = await probeBackendOnce({ port });
    expect(found).toMatchObject({ alive: true, pid: 7 });
  });
});
