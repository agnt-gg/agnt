/**
 * Behavioural tests for the shutdown guarantee.
 *
 * These use a REAL http.Server with REAL open sockets, because the bug was
 * entirely about what a real server does when connections are held open — a
 * mocked server would have "passed" against the broken code that shipped.
 * Only `exit` is injected, since the alternative is killing the test runner.
 *
 * The failure being pinned: AGNT holds Socket.IO and SSE streams open by
 * design, server.close() waits for every one of them, so the old handler's
 * process.exit(0) was unreachable and the backend outlived SIGTERM forever.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { createGracefulShutdown } from './gracefulShutdown.js';

const silent = { log: () => {}, warn: () => {}, error: () => {} };
const open = [];

/** A server that answers, plus a client socket deliberately left open. */
async function serverWithOpenConnection({ streaming = false } = {}) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    if (streaming) {
      // An SSE-shaped response: headers sent, body never ended. This is what
      // AGNT's realtime streams look like to server.close().
      res.write('open\n');
    } else {
      res.end('ok');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const socket = net.connect(port, '127.0.0.1');
  open.push(server, socket);
  await new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.on('connect', () => {
      socket.write('GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n');
      // Wait for the response to start so the connection is genuinely tracked
      // by the server, not merely accepted.
      socket.once('data', () => resolve());
    });
  });
  return { server, socket, port };
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

describe('createGracefulShutdown — the guarantee', () => {
  it('exits even though a keep-alive connection is still open', async () => {
    const { server } = await serverWithOpenConnection();
    const exit = vi.fn();

    createGracefulShutdown({ server, exit, log: silent })('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2000 });
  });

  it('exits PROMPTLY, from closing sockets rather than from the deadline', async () => {
    // The distinction matters. A hard deadline alone would also make the test
    // above pass, while every real shutdown still took the full 3s and looked
    // like a hang. Idle keep-alive sockets must be closed at t=0.
    const { server } = await serverWithOpenConnection();
    const exit = vi.fn();
    const started = Date.now();

    createGracefulShutdown({ server, exit, log: silent })('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalled(), { timeout: 2000 });
    expect(Date.now() - started).toBeLessThan(900); // < forceCloseAfterMs
  });

  it('exits when a STREAMING response is open — the actual AGNT case', async () => {
    // An in-flight response is not idle, so closeIdleConnections() cannot touch
    // it. This is the connection shape that wedged the real backend, and it is
    // why the force-close stage exists at all.
    const { server } = await serverWithOpenConnection({ streaming: true });
    const exit = vi.fn();

    createGracefulShutdown({ server, exit, log: silent, forceCloseAfterMs: 100 })('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2000 });
  });

  it('exits on the hard deadline when server.close() never calls back', async () => {
    // The last line of defence: a server implementation that simply never
    // completes must still not be able to keep the process alive.
    const wedged = { close: () => {}, closeIdleConnections: () => {}, closeAllConnections: () => {} };
    const exit = vi.fn();

    createGracefulShutdown({ server: wedged, exit, log: silent, hardDeadlineMs: 150 })('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2000 });
  });

  it('exits even if the drain step rejects', async () => {
    // WorkflowProcessBridge.shutdown() used to be awaited FIRST. A rejection
    // there took the whole shutdown with it.
    const { server } = await serverWithOpenConnection();
    const exit = vi.fn();

    createGracefulShutdown({
      server,
      exit,
      log: silent,
      drain: () => Promise.reject(new Error('bridge is wedged')),
    })('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2000 });
  });

  it('exits even if the drain step hangs forever', async () => {
    const { server } = await serverWithOpenConnection();
    const exit = vi.fn();

    createGracefulShutdown({
      server,
      exit,
      log: silent,
      drain: () => new Promise(() => {}),
    })('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0), { timeout: 2000 });
  });

  it('runs the sequence once, however many signals arrive', async () => {
    // A terminal that sends SIGINT after a supervisor's SIGTERM must not start
    // a second teardown around an already-closing server: it re-arms both
    // timers and calls close() again, so a stale deadline can fire an exit for
    // a shutdown that already finished.
    //
    // Asserting only on the exit count is NOT enough — measured: leave() has
    // its own guard, so removing the re-entry guard entirely still yields
    // exactly one exit. The observable that actually moves is close().
    const { server } = await serverWithOpenConnection();
    const exit = vi.fn();
    const close = vi.spyOn(server, 'close');
    const shutdown = createGracefulShutdown({ server, exit, log: silent });

    shutdown('SIGTERM');
    shutdown('SIGINT');
    shutdown('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalled(), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 250));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(close, 'the teardown ran more than once').toHaveBeenCalledTimes(1);
  });

  it('still exits if server.close() throws outright', async () => {
    const exit = vi.fn();
    const hostile = {
      close: () => {
        throw new Error('not a server');
      },
    };

    createGracefulShutdown({ server: hostile, exit, log: silent })('SIGTERM');

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('does not start draining before the exit guarantee is armed', async () => {
    // ORDERING IS THE BUG. The original handler awaited the bridge first, so a
    // hang there happened while nothing at all was guaranteeing termination.
    const order = [];
    const wedged = {
      close: () => order.push('close'),
      closeIdleConnections: () => {},
      closeAllConnections: () => {},
    };
    const exit = vi.fn(() => order.push('exit'));

    createGracefulShutdown({
      server: wedged,
      exit,
      log: silent,
      hardDeadlineMs: 100,
      drain: () => {
        order.push('drain');
        return new Promise(() => {});
      },
    })('SIGTERM');

    await vi.waitFor(() => expect(exit).toHaveBeenCalled(), { timeout: 2000 });
    expect(order.indexOf('close')).toBeLessThan(order.indexOf('drain'));
    expect(order).toContain('exit');
  });
});
