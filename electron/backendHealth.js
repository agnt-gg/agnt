/**
 * Backend health polling — "is the backend I am supposed to talk to answering?"
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN MODULE
 * ---------------------------------------------------------------------------
 * This logic used to be ~60 lines inside main.js, where it could not be tested
 * and where its bound was wrong in a way nobody could see. The remote policy was
 * `maxAttempts: 24` with the comment "~12s of polling before we tell the user".
 *
 * MEASURED, against the shipped code:
 *   connection refused (host up, AGNT down) ....    6.3s  ✔ matches the comment
 *   accepts TCP but never replies ..............  366.7s  ✘ 30x over
 *   SYN dropped (host powered off / DROP rule) .  366.5s  ✘ 30x over
 *
 * Because the bound was on ATTEMPT COUNT while each attempt carried a 15s socket
 * timeout, an *unresponsive* server — as opposed to an absent one — produced six
 * minutes of nothing. And the window was only created in the success callback,
 * so for those six minutes the app was a dock icon with no window: from the
 * outside, indistinguishable from a hang.
 *
 * An attempt count is not a bound on anything a user can feel. Wall clock is.
 * So the primary bound here is `deadlineMs`, enforced by a real timer that fires
 * even while a request is hung, and each attempt's socket timeout is additionally
 * clamped to the time remaining so it can never overshoot.
 *
 * LOCAL MODE IS UNCHANGED, DELIBERATELY: infinite attempts, no deadline, 30s
 * request timeout, flat 250ms retry. The local backend is ours and it is coming
 * up; a desktop app that gives up on its own backend is useless. LOCAL_POLICY is
 * byte-for-byte the behaviour that shipped, and backendHealth.test.js pins that.
 */

import http from 'node:http';
import https from 'node:https';

/**
 * Local backend: unbounded, exactly as it has always been.
 * The 30s request timeout is not a typo — the backend can block its event loop
 * during plugin/skill init and still be perfectly healthy.
 */
export const LOCAL_POLICY = Object.freeze({
  requestTimeoutMs: 30_000,
  retryDelayMs: 250,
  maxAttempts: Infinity,
  deadlineMs: Infinity,
});

/**
 * Remote backend: bounded by wall clock.
 *
 * 2.5s per attempt because a health check on a server that is actually there
 * answers in single-digit milliseconds; a long per-attempt timeout buys nothing
 * except a slower verdict. 20s total because the window now appears immediately
 * with a live status and an escape hatch (main.js), so waiting a little longer
 * costs the user nothing and lets a cold-starting cloud container win the race.
 * The short attempt timeout means ~7 tries inside that window, so a server that
 * comes up at t=9s is picked up at t≈9s rather than at the next 15s boundary.
 */
export const REMOTE_POLICY = Object.freeze({
  requestTimeoutMs: 2_500,
  retryDelayMs: 250,
  maxAttempts: Infinity,
  deadlineMs: 20_000,
});

/**
 * Build the request options for a health probe.
 *
 * @param {{ baseUrl?: string|null, port?: number|string }} target
 * @returns {{ transport: typeof http, options: object, describe: string }}
 */
export function healthTarget({ baseUrl = null, port = 3333 } = {}) {
  if (baseUrl) {
    const url = new URL(baseUrl);
    const isHttps = url.protocol === 'https:';
    return {
      transport: isHttps ? https : http,
      describe: `${url.origin}/api/health`,
      options: {
        hostname: url.hostname,
        port: url.port ? parseInt(url.port, 10) : isHttps ? 443 : 80,
        path: '/api/health',
        method: 'GET',
      },
    };
  }
  return {
    transport: http,
    describe: `http://127.0.0.1:${port}/api/health`,
    options: {
      // 127.0.0.1 rather than 'localhost': avoids a DNS round trip and the
      // ::1-first resolution that made the first probe fail on some machines.
      hostname: '127.0.0.1',
      port: parseInt(port, 10),
      path: '/api/health',
      method: 'GET',
    },
  };
}

/**
 * Poll a backend's /api/health until it answers 200, then call onReady().
 *
 * @param {object}   spec
 * @param {string}  [spec.baseUrl]   remote origin; omit for the local backend
 * @param {number}  [spec.port]      local port (ignored when baseUrl is set)
 * @param {object}  [spec.policy]    LOCAL_POLICY / REMOTE_POLICY / an override
 * @param {Function} spec.onReady    called once, when the backend answers 200
 * @param {Function} [spec.onFail]   called once, when the bound is exhausted
 * @param {Function} [spec.onAttempt] ({ attempt, elapsedMs, remainingMs, reason })
 * @param {Function} [spec.log]
 * @param {object}  [spec.deps]      { transport, setTimer, clearTimer, now } for tests
 * @returns {{ cancel: (why?: string) => void, cancelled: () => boolean }}
 */
export function waitForBackend({
  baseUrl = null,
  port = 3333,
  policy = null,
  onReady,
  onFail = null,
  onAttempt = null,
  log = () => {},
  deps = {},
} = {}) {
  const {
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = () => Date.now(),
  } = deps;

  const effective = { ...(policy || (baseUrl ? REMOTE_POLICY : LOCAL_POLICY)) };
  const target = healthTarget({ baseUrl, port });
  const transport = deps.transport || target.transport;

  const startedAt = now();
  let attempt = 0;
  let settled = false;
  let cancelled = false;
  let inFlight = null;
  let retryTimer = null;
  let deadlineTimer = null;

  const elapsed = () => now() - startedAt;
  const remaining = () =>
    Number.isFinite(effective.deadlineMs) ? Math.max(0, effective.deadlineMs - elapsed()) : Infinity;

  const teardown = () => {
    if (retryTimer) clearTimer(retryTimer);
    if (deadlineTimer) clearTimer(deadlineTimer);
    retryTimer = null;
    deadlineTimer = null;
    // Destroying an in-flight request emits 'error'; `settled` already guards
    // the handlers, so this cannot resurrect a retry loop.
    if (inFlight) {
      try {
        inFlight.destroy();
      } catch {
        /* already gone */
      }
      inFlight = null;
    }
  };

  const succeed = () => {
    if (settled) return;
    settled = true;
    teardown();
    log(`Backend is ready (${target.describe}, ${elapsed()}ms, ${attempt} attempt(s)).`);
    onReady();
  };

  const giveUp = (why) => {
    if (settled) return;
    settled = true;
    teardown();
    log(`Backend unreachable: ${target.describe} — ${why} after ${elapsed()}ms / ${attempt} attempt(s).`);
    if (onFail) onFail({ why, elapsedMs: elapsed(), attempts: attempt, url: baseUrl, describe: target.describe });
  };

  // THE fix. A timer, not a counter: it fires while a request is hung, which is
  // exactly the state that produced six minutes of dead app.
  if (Number.isFinite(effective.deadlineMs)) {
    deadlineTimer = setTimer(() => giveUp(`no response within ${effective.deadlineMs}ms`), effective.deadlineMs);
  }

  const scheduleRetry = (reason) => {
    if (settled) return;
    if (attempt >= effective.maxAttempts) return giveUp('attempt limit reached');
    // Nothing useful can happen in less than a retry delay, so stop early
    // rather than firing a request the deadline will kill mid-flight.
    if (remaining() <= effective.retryDelayMs) {
      return giveUp(`no response within ${effective.deadlineMs}ms`);
    }
    if (onAttempt) {
      onAttempt({ attempt, elapsedMs: elapsed(), remainingMs: remaining(), reason });
    }
    retryTimer = setTimer(probe, effective.retryDelayMs);
  };

  function probe() {
    if (settled) return;
    attempt += 1;

    // No clamping against the remaining budget: a negative control proved it
    // redundant. When the deadline fires, teardown() destroys the in-flight
    // request, so a per-attempt timeout longer than the budget cannot extend
    // anything. One bound, enforced in one place.
    const options = { ...target.options, timeout: effective.requestTimeoutMs };

    let req;
    try {
      req = transport.request(options, (res) => {
        // Drain: an undrained response keeps the socket (and the process
        // handle) alive even after we stop caring about it.
        res.resume();
        res.on('end', () => {
          if (settled) return;
          if (res.statusCode === 200) return succeed();
          scheduleRetry(`status ${res.statusCode}`);
        });
      });
    } catch (err) {
      // transport.request can throw synchronously (a hostname the URL parser
      // accepted but the socket layer rejects). Unhandled, that took down the
      // whole main process from inside a timer callback.
      return scheduleRetry(`request failed: ${err.message}`);
    }

    inFlight = req;
    req.on('error', (err) => {
      if (settled) return;
      inFlight = null;
      scheduleRetry(err.message);
    });
    req.on('timeout', () => {
      // Destroy only. The resulting 'error' drives the retry, so handling both
      // here would double-fire (it used to produce back-to-back
      // "timed out" / "socket hang up" pairs in the log).
      req.destroy();
    });
    req.end();
  }

  probe();

  return {
    cancel: (why = 'cancelled') => {
      if (settled) return;
      settled = true;
      cancelled = true;
      teardown();
      log(`Backend health polling ${why} after ${elapsed()}ms.`);
    },
    cancelled: () => cancelled,
  };
}

/**
 * One-shot "is an AGNT already listening on this port?" question.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The app used to fork its backend unconditionally and only afterwards ask
 * whether a backend was answering. When something already owned the port, the
 * fork lost the bind, retried five times, exited 1, and the supervisor read
 * that as a crash and quit the whole app — while a perfectly healthy AGNT was
 * answering on that very port the entire time.
 *
 * Asking BEFORE spawning turns an unrecoverable crash into a choice, so this is
 * deliberately a different shape from waitForBackend(): it answers once, it
 * answers fast, and it answers with WHO is there rather than just "something".
 *
 * `alive` is true only for a 200 carrying AGNT's own health body. Anything else
 * listening on the port — another dev server, a proxy, a captive portal — is
 * reported as not-alive with a reason, because the two cases have completely
 * different remedies and must never be confused: one is "attach or replace",
 * the other is "that isn't us, don't touch it".
 *
 * @param {{ port?: number|string, timeoutMs?: number, deps?: object }} spec
 * @returns {Promise<{ alive: boolean, pid: number|null, version: string|null, reason: string|null }>}
 */
export function probeBackendOnce({ port = 3333, timeoutMs = 1_500, deps = {} } = {}) {
  const target = healthTarget({ port });
  const transport = deps.transport || target.transport;

  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve({ alive: false, pid: null, version: null, reason: null, ...result });
    };

    let req;
    try {
      req = transport.request({ ...target.options, timeout: timeoutMs }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        // Cap the read: a hostile or merely wrong listener on this port must not
        // be able to buffer unbounded memory into the main process.
        res.on('data', (chunk) => {
          if (body.length < 4096) body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode !== 200) return done({ reason: `status ${res.statusCode}` });
          let json = null;
          try {
            json = JSON.parse(body);
          } catch {
            /* not JSON, therefore not ours */
          }
          if (!json || json.status !== 'OK') {
            return done({ reason: 'something is listening, but it is not AGNT' });
          }
          done({
            alive: true,
            pid: Number.isInteger(json.pid) ? json.pid : null,
            version: typeof json.version === 'string' ? json.version : null,
          });
        });
      });
    } catch (err) {
      return done({ reason: err.message });
    }

    req.on('error', (err) => done({ reason: err.message }));
    // Destroy only — the resulting 'error' settles us, exactly as in probe().
    req.on('timeout', () => req.destroy());
    req.end();
  });
}

export default { waitForBackend, probeBackendOnce, healthTarget, LOCAL_POLICY, REMOTE_POLICY };
