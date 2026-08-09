/**
 * THE SESSION TOKEN REACHES THE PROCESS THAT ACTUALLY USES IT.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * sessionTokenCache was built so background work could identify itself to
 * api.agnt.gg. Its own header names the consumers: "EmailReceiver /
 * WebhookReceiver poll every 10 seconds from a timer". It shipped with 13 green
 * unit tests and did not work, because every one of those tests called the
 * writer and the reader from the SAME process.
 *
 * In production they are not the same process. The writer is the Express
 * middleware in the main process; the readers are pollers in a forked child.
 * The cache is in-memory, so the child's copy stayed empty forever, every
 * outbound call went anonymous, and the adoption counter that the entire staged
 * rollout waits on was pinned at 0% of 205 observations — a number that could
 * not move no matter how many clients updated.
 *
 * A mock cannot catch that. Mocked children share the parent's module registry,
 * so the parent's cache answers the child's question and the illusion holds.
 * These tests therefore fork a REAL child process.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS ENCODES
 * ---------------------------------------------------------------------------
 * Any state shared between a parent and a forked child needs one test that
 * WRITES IN ONE PROCESS AND READS IN THE OTHER. If a module's own comment names
 * a process boundary, that boundary is the test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fork } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(here, '__fixtures__', 'tokenCacheChild.mjs');

/** Fork the fixture and collect its reports. Always killed in afterEach. */
const spawned = [];
function forkChild() {
  const child = fork(CHILD, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, IS_WORKFLOW_PROCESS: 'true' },
  });
  spawned.push(child);

  const reports = [];
  child.on('message', (m) => reports.push(m));
  return { child, reports };
}

/** Wait for a report with the given stage, or fail loudly rather than hang. */
async function waitFor(reports, stage, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const hit = reports.find((r) => r.stage === stage);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`child never reported stage '${stage}' (saw: ${reports.map((r) => r.stage).join(', ') || 'nothing'})`);
}

afterEach(() => {
  for (const child of spawned.splice(0)) {
    if (child.connected) child.disconnect();
    child.kill('SIGKILL');
  }
  vi.restoreAllMocks();
});

describe('the token crosses the fork', () => {
  it('a freshly forked child has NO credential (the starting state)', async () => {
    const { reports } = forkChild();
    const initial = await waitFor(reports, 'initial');

    expect(initial.pid).not.toBe(process.pid);
    expect(initial.isWorkflowProcess, 'fixture must run as the workflow process would').toBe(true);
    expect(initial.header).toEqual({});
    expect(initial.token).toBeNull();
  });

  it('THE REGRESSION: a token set only in THIS process never reaches the child', async () => {
    // This is the assertion whose absence let the original defect ship. It
    // fails against any implementation that assumes an in-memory cache is
    // shared across a fork — which is precisely what was assumed.
    const cache = await import('./sessionTokenCache.js');
    cache.__resetSessionTokenCacheForTests();
    cache.rememberSessionToken('parent-only-token', 'user-1');
    expect(cache.authHeader(), 'sanity: the parent really does hold a token').toEqual({
      Authorization: 'Bearer parent-only-token',
    });

    const { child, reports } = forkChild();
    await waitFor(reports, 'initial');

    child.send({ type: 'REPORT' });
    const seen = await waitFor(reports, 'on-demand');

    expect(seen.header, 'the child must NOT inherit the parent cache').toEqual({});
    expect(seen.token).toBeNull();

    cache.__resetSessionTokenCacheForTests();
  });

  it('the child DOES get a credential once the token is sent over IPC', async () => {
    const { child, reports } = forkChild();
    await waitFor(reports, 'initial');

    child.send({ type: 'SESSION_TOKEN', data: { token: 'tok-from-parent', userId: 'user-1' } });
    const after = await waitFor(reports, 'after-token');

    // The whole point: authHeader() inside the CHILD now returns a real header,
    // so every poller and workflow node in that process starts identifying.
    expect(after.header).toEqual({ Authorization: 'Bearer tok-from-parent' });
    expect(after.token).toBe('tok-from-parent');
    expect(after.userId).toBe('user-1');
  });

  it('a malformed message leaves the child anonymous rather than sending "Bearer undefined"', async () => {
    const { child, reports } = forkChild();
    await waitFor(reports, 'initial');

    child.send({ type: 'SESSION_TOKEN', data: { token: undefined, userId: 'user-1' } });
    const after = await waitFor(reports, 'after-token');

    // `Authorization: Bearer undefined` is the exact string that turned a
    // missing webhook credential into a valid password. An absent header is the
    // only safe answer.
    expect(after.header).toEqual({});
  });
});

describe('the bridge forwards it', () => {
  let bridge;
  let cache;

  beforeEach(async () => {
    vi.resetModules();
    cache = await import('./sessionTokenCache.js');
    cache.__resetSessionTokenCacheForTests();
    bridge = (await import('../../workflow/WorkflowProcessBridge.js')).default;
  });

  /** Stands in for a live child: records what the bridge sends it. */
  const fakeChild = (connected = true) => ({ connected, sent: [], send(m) { this.sent.push(m); } });

  it('sends the token to the child when a NEW token is remembered', () => {
    const child = fakeChild();
    bridge.workflowProcess = child;

    cache.rememberSessionToken('tok-1', 'user-1');

    expect(child.sent).toHaveLength(1);
    expect(child.sent[0]).toEqual({ type: 'SESSION_TOKEN', data: { token: 'tok-1', userId: 'user-1' } });
  });

  it('does NOT resend on every request — only when the token changes', () => {
    // rememberSessionToken runs on EVERY authenticated request. Forwarding
    // unconditionally would put hundreds of IPC messages a minute on the wire
    // to re-deliver a token the child already has.
    const child = fakeChild();
    bridge.workflowProcess = child;

    cache.rememberSessionToken('tok-1', 'user-1');
    cache.rememberSessionToken('tok-1', 'user-1');
    cache.rememberSessionToken('tok-1', 'user-1');
    expect(child.sent).toHaveLength(1);

    cache.rememberSessionToken('tok-2', 'user-1'); // a refresh IS a change
    expect(child.sent).toHaveLength(2);
    expect(child.sent[1].data.token).toBe('tok-2');
  });

  it('never throws into the request path when the child is gone', () => {
    bridge.workflowProcess = null;
    expect(() => cache.rememberSessionToken('tok-1', 'user-1')).not.toThrow();

    bridge.workflowProcess = fakeChild(false); // disconnected
    expect(() => cache.rememberSessionToken('tok-2', 'user-1')).not.toThrow();
    expect(bridge.workflowProcess.sent).toHaveLength(0);
  });

  it('survives a child whose send() throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.workflowProcess = {
      connected: true,
      send() { throw new Error('EPIPE'); },
    };
    expect(() => cache.rememberSessionToken('tok-1', 'user-1')).not.toThrow();
  });

  it('re-sends to a RESPAWNED child, which starts with an empty cache', () => {
    // A crash at 3am would otherwise leave every background call anonymous
    // until the user next opened the UI — and the token lasts 30 days.
    cache.rememberSessionToken('tok-1', 'user-1');

    const replacement = fakeChild();
    const pushed = bridge.pushSessionToken(replacement);

    expect(pushed).toBe(true);
    expect(replacement.sent[0]).toEqual({
      type: 'SESSION_TOKEN',
      data: { token: 'tok-1', userId: 'user-1' },
    });
  });

  it('a poisoned cache forwards nothing (two users on one install)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const child = fakeChild();
    bridge.workflowProcess = child;

    cache.rememberSessionToken('tok-a', 'user-1');
    child.sent.length = 0;
    cache.rememberSessionToken('tok-b', 'user-2'); // poisons

    expect(child.sent, 'a wrong token is worse than no token').toHaveLength(0);
    expect(bridge.pushSessionToken(fakeChild())).toBe(false);
  });
});

describe('the child handler is wired to the real dispatcher', () => {
  // The fork tests above prove the MECHANISM. This proves the production
  // handler uses it — WorkflowProcess.js boots a database and a plugin system,
  // so it is asserted at the source rather than executed here.
  const source = () => {
    const file = path.join(here, '..', '..', 'workflow', 'WorkflowProcess.js');
    return fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  };

  it('imports the cache and calls rememberSessionToken for SESSION_TOKEN', () => {
    const code = source();
    expect(code).toMatch(/from '\.\.\/services\/auth\/sessionTokenCache\.js'/);
    expect(code).toMatch(/SESSION_TOKEN/);

    const handler = code.slice(code.indexOf('SESSION_TOKEN'), code.indexOf('SESSION_TOKEN') + 300);
    expect(handler, 'the SESSION_TOKEN branch must populate the cache').toMatch(/rememberSessionToken\(/);
  });

  it('anti-vacuity: that scan fails on a handler that ignores the message', () => {
    // If the slice or the regex broke, the test above would pass against a
    // handler that does nothing at all.
    const decoy = "if (type === 'SESSION_TOKEN') { return; }";
    const slice = decoy.slice(decoy.indexOf('SESSION_TOKEN'), decoy.indexOf('SESSION_TOKEN') + 300);
    expect(/rememberSessionToken\(/.test(slice)).toBe(false);
  });
});
