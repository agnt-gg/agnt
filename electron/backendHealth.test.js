/**
 * Backend health polling.
 *
 * The bug this module exists to fix could not be caught by a unit test of the
 * old code, because the old code was 60 lines inside main.js. So these tests run
 * against REAL SOCKETS — including a server that accepts TCP and then says
 * nothing, which is the precise shape ("the remote server is not responsive")
 * that produced a measured 366 seconds of dead app.
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { waitForBackend, healthTarget, LOCAL_POLICY, REMOTE_POLICY } from './backendHealth.js';

/** An HTTP server whose /api/health status is whatever `status()` returns. */
function healthServer(status = () => 200) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(status(), { 'Content-Type': 'application/json' });
      res.end('{"status":"OK"}');
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

/** Accepts the connection, swallows the request, never replies. */
function blackhole() {
  return new Promise((resolve) => {
    const sockets = [];
    const srv = net.createServer((sock) => {
      sockets.push(sock);
      sock.on('data', () => {});
      sock.on('error', () => {});
    });
    srv.listen(0, '127.0.0.1', () =>
      resolve({
        srv,
        url: `http://127.0.0.1:${srv.address().port}`,
        close: () => {
          for (const s of sockets) s.destroy();
          srv.close();
        },
      })
    );
  });
}

/** A port nothing is listening on: the OS answers RST immediately. */
function closedPort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const settle = (spec) =>
  new Promise((resolve) => {
    const t0 = Date.now();
    const handle = waitForBackend({
      ...spec,
      onReady: () => resolve({ outcome: 'ready', ms: Date.now() - t0, handle }),
      onFail: (info) => resolve({ outcome: 'fail', ms: Date.now() - t0, info, handle }),
    });
  });

describe('happy path', () => {
  it('resolves as soon as the backend answers 200', async () => {
    const s = await healthServer();
    const r = await settle({ baseUrl: s.url, policy: { ...REMOTE_POLICY, deadlineMs: 3000 } });
    expect(r.outcome).toBe('ready');
    expect(r.ms).toBeLessThan(1000);
    s.srv.close();
  });

  it('keeps polling through non-200 until the backend finishes booting', async () => {
    let hits = 0;
    const s = await healthServer(() => (++hits < 3 ? 503 : 200));
    const r = await settle({ baseUrl: s.url, policy: { ...REMOTE_POLICY, deadlineMs: 5000 } });
    expect(r.outcome).toBe('ready');
    expect(hits).toBeGreaterThanOrEqual(3);
    s.srv.close();
  });

  it('picks up a server that only comes up mid-poll', async () => {
    const port = await closedPort();
    setTimeout(() => {
      const srv = http.createServer((_q, res) => {
        res.writeHead(200);
        res.end('{}');
      });
      srv.listen(port, '127.0.0.1');
      setTimeout(() => srv.close(), 2500);
    }, 700);

    const r = await settle({ baseUrl: `http://127.0.0.1:${port}`, policy: { ...REMOTE_POLICY, deadlineMs: 5000 } });
    expect(r.outcome).toBe('ready');
    expect(r.ms).toBeGreaterThan(600);
  });
});

describe('the wall-clock bound (the actual fix)', () => {
  it('gives up on a server that accepts TCP and never replies, WITHIN the deadline', async () => {
    // THE REGRESSION TEST. The shipped code bounded on attempt count while each
    // attempt carried a 15s socket timeout, so this shape took 366s. Here the
    // per-attempt timeout is deliberately set far LONGER than the deadline: only
    // a real wall-clock timer can pass this.
    const bh = await blackhole();
    const r = await settle({
      baseUrl: bh.url,
      policy: { requestTimeoutMs: 30_000, retryDelayMs: 250, maxAttempts: Infinity, deadlineMs: 700 },
    });
    expect(r.outcome).toBe('fail');
    expect(r.ms).toBeLessThan(2000);
    expect(r.info.why).toMatch(/700ms/);
    bh.close();
  });

  it('gives up when the packets are dropped outright (host powered off)', async () => {
    // No RST ever comes back, so connect() hangs until something interrupts it.
    const r = await settle({
      baseUrl: 'http://10.255.255.1:3333',
      policy: { requestTimeoutMs: 30_000, retryDelayMs: 250, maxAttempts: Infinity, deadlineMs: 700 },
    });
    expect(r.outcome).toBe('fail');
    expect(r.ms).toBeLessThan(2000);
  });

  it('a per-attempt timeout longer than the budget cannot defeat the deadline', async () => {
    // This is the shipped shape exactly: a 15s socket timeout with a much
    // shorter intended bound. Only a real timer can interrupt it.
    const bh = await blackhole();
    const r = await settle({
      baseUrl: bh.url,
      policy: { requestTimeoutMs: 15_000, retryDelayMs: 100, maxAttempts: Infinity, deadlineMs: 500 },
    });
    expect(r.outcome).toBe('fail');
    expect(r.ms).toBeLessThan(1500);
    bh.close();
  });

  it('reports the failure with enough detail to show the user', async () => {
    const port = await closedPort();
    const r = await settle({
      baseUrl: `http://127.0.0.1:${port}`,
      policy: { ...REMOTE_POLICY, deadlineMs: 600 },
    });
    expect(r.outcome).toBe('fail');
    expect(r.info).toMatchObject({ url: `http://127.0.0.1:${port}` });
    expect(r.info.attempts).toBeGreaterThan(0);
    expect(typeof r.info.why).toBe('string');
    expect(r.info.describe).toContain('/api/health');
  });

  it('still honours an explicit attempt cap when one is given', async () => {
    const port = await closedPort();
    const r = await settle({
      baseUrl: `http://127.0.0.1:${port}`,
      policy: { requestTimeoutMs: 1000, retryDelayMs: 10, maxAttempts: 3, deadlineMs: Infinity },
    });
    expect(r.outcome).toBe('fail');
    expect(r.info.why).toMatch(/attempt limit/);
    expect(r.info.attempts).toBe(3);
  });
});

describe('local policy is unchanged, deliberately', () => {
  it('keeps the shipped values exactly', () => {
    // These are the numbers that were in main.js. The local backend is ours and
    // it is coming up; a desktop app that gives up on its own backend is
    // useless. Any change here is a behaviour change for every existing user.
    expect(LOCAL_POLICY).toEqual({
      requestTimeoutMs: 30_000,
      retryDelayMs: 250,
      maxAttempts: Infinity,
      deadlineMs: Infinity,
    });
  });

  it('is the default when no baseUrl is given', async () => {
    const port = await closedPort();
    let attempts = 0;
    const handle = waitForBackend({
      port,
      onReady: () => {
        throw new Error('must not be ready');
      },
      onFail: () => {
        throw new Error('local mode must never give up');
      },
      onAttempt: () => {
        attempts += 1;
      },
    });
    await new Promise((r) => setTimeout(r, 900));
    expect(attempts).toBeGreaterThan(1); // still trying
    handle.cancel();
    expect(handle.cancelled()).toBe(true);
  });

  it('remote policy, by contrast, is bounded by wall clock and not by attempts', () => {
    expect(Number.isFinite(REMOTE_POLICY.deadlineMs)).toBe(true);
    expect(REMOTE_POLICY.deadlineMs).toBeLessThanOrEqual(30_000);
    // A short per-attempt timeout is what buys many tries inside the window; a
    // long one is what turned a 12s bound into six minutes.
    expect(REMOTE_POLICY.requestTimeoutMs).toBeLessThan(REMOTE_POLICY.deadlineMs);
  });
});

describe('cancellation', () => {
  it('releases the deadline timer, so a cancelled poll cannot outlive the app', async () => {
    // `settled` already stops onFail from firing after cancel(), so behaviour
    // alone cannot detect a leaked timer — a negative control that removed the
    // clearTimer stayed green. Assert the release through the injected clock.
    const cleared = [];
    const timers = new Map();
    let seq = 0;
    const deps = {
      setTimer: (fn, ms) => {
        const id = (seq += 1);
        timers.set(id, ms);
        return id;
      },
      clearTimer: (id) => {
        if (timers.has(id)) cleared.push(timers.get(id));
        timers.delete(id);
      },
    };
    const port = await closedPort();
    const handle = waitForBackend({
      baseUrl: `http://127.0.0.1:${port}`,
      policy: { requestTimeoutMs: 500, retryDelayMs: 50, maxAttempts: Infinity, deadlineMs: 4321 },
      onReady: () => {},
      onFail: () => {},
      deps,
    });
    handle.cancel();
    expect(cleared, 'the deadline timer was never cleared').toContain(4321);
  });

  it('stops polling and never calls onReady or onFail afterwards', async () => {
    const port = await closedPort();
    let ready = 0;
    let failed = 0;
    const handle = waitForBackend({
      baseUrl: `http://127.0.0.1:${port}`,
      policy: { requestTimeoutMs: 500, retryDelayMs: 50, maxAttempts: Infinity, deadlineMs: 400 },
      onReady: () => (ready += 1),
      onFail: () => (failed += 1),
    });
    handle.cancel('user switched to local');
    await new Promise((r) => setTimeout(r, 800));
    expect(ready).toBe(0);
    // Without cancellation the 400ms deadline would have fired inside this wait,
    // so a passing assertion here proves the deadline timer was cleared.
    expect(failed).toBe(0);
  });
});

describe('robustness', () => {
  it('retries instead of crashing when the transport throws synchronously', async () => {
    // request() can throw synchronously for a host the URL parser accepted but
    // the socket layer rejects. Unhandled inside a timer callback, that took
    // down the entire main process.
    let calls = 0;
    const exploding = {
      request: () => {
        calls += 1;
        throw new Error('getaddrinfo went sideways');
      },
    };
    const r = await settle({
      baseUrl: 'http://whatever:3333',
      policy: { requestTimeoutMs: 100, retryDelayMs: 20, maxAttempts: Infinity, deadlineMs: 300 },
      deps: { transport: exploding },
    });
    expect(r.outcome).toBe('fail');
    expect(calls).toBeGreaterThan(1);
  });

  it('drains the response body, without which the retry loop stalls', async () => {
    // A response with no 'data' listener and no resume() stays PAUSED, so 'end'
    // never fires and the next attempt is never scheduled — the poll would sit
    // on attempt 1 until the deadline. Counting server hits is the observable
    // proof that the body is consumed.
    // (The previous version of this test asserted that a Node internal existed,
    // which is true whether the code drains or not.)
    let hits = 0;
    const s = await healthServer(() => {
      hits += 1;
      return 503;
    });
    const r = await settle({
      baseUrl: s.url,
      policy: { requestTimeoutMs: 5_000, retryDelayMs: 20, maxAttempts: Infinity, deadlineMs: 700 },
    });
    expect(r.outcome).toBe('fail');
    expect(hits, 'the poll stalled after the first response').toBeGreaterThan(3);
    s.srv.close();
  });

  it('reports progress so the UI can show something other than a spinner', async () => {
    const port = await closedPort();
    const seen = [];
    await settle({
      baseUrl: `http://127.0.0.1:${port}`,
      policy: { requestTimeoutMs: 300, retryDelayMs: 50, maxAttempts: Infinity, deadlineMs: 600 },
      onAttempt: (info) => seen.push(info),
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toHaveProperty('attempt');
    expect(seen[0]).toHaveProperty('elapsedMs');
    expect(seen[0].reason).toBeTruthy();
  });
});

describe('healthTarget', () => {
  it('probes loopback by IP for the local backend', () => {
    // 'localhost' costs a DNS round trip and can resolve ::1 first, which made
    // the first probe fail on some machines.
    const t = healthTarget({ port: 3333 });
    expect(t.options).toMatchObject({ hostname: '127.0.0.1', port: 3333, path: '/api/health' });
  });

  it('uses the remote host and port', () => {
    const t = healthTarget({ baseUrl: 'http://192.168.1.50:3333' });
    expect(t.options).toMatchObject({ hostname: '192.168.1.50', port: 3333 });
  });

  it('defaults the port by scheme, so https://mine.agnt.cloud works', () => {
    expect(healthTarget({ baseUrl: 'https://mine.agnt.cloud' }).options.port).toBe(443);
    expect(healthTarget({ baseUrl: 'http://mine.agnt.cloud' }).options.port).toBe(80);
  });

  it('selects the https transport for an https remote (AGNT Cloud)', () => {
    expect(healthTarget({ baseUrl: 'https://x.agnt.cloud' }).transport.globalAgent.protocol).toBe('https:');
    expect(healthTarget({ baseUrl: 'http://x.agnt.cloud' }).transport.globalAgent.protocol).toBe('http:');
  });
});
