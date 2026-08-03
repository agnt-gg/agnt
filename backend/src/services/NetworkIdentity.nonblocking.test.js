/**
 * The network name is one line of garnish in the Phone Access panel, and it
 * used to be on the critical path of /pairing/status: the route awaited
 * `netsh wlan show interfaces`, turning an 8ms endpoint into a measured 142ms
 * one — every 60 seconds, forever, and once per poll whenever the TTL lapsed
 * mid-session.
 *
 * These tests pin the contract that replaced it: reads are synchronous and
 * always cheap, the OS is consulted in the background, and a probe that fails
 * does not erase an answer we already had.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Controls what the next spawned "process" does. Set per test. */
const probe = { calls: 0, behaviour: null };

vi.mock('child_process', () => ({
  execFile: (cmd, args, opts, cb) => {
    probe.calls++;
    // Asynchronous, like the real thing — that is the whole point.
    setTimeout(() => probe.behaviour(cb), 5);
    return { on: () => {} };
  },
}));

const { getNetworkName, primeNetworkName, _resetNetworkNameCache } = await import(
  './NetworkIdentity.js'
);

// The parsers are platform-specific; the behaviour under test is not.
const CONNECTED =
  process.platform === 'win32'
    ? '    SSID                   : Example Network 5G\n'
    : process.platform === 'darwin'
      ? 'Current Wi-Fi Network: Example Network 5G\n'
      : 'Example Network 5G\n';

const NO_WIFI =
  process.platform === 'win32'
    ? '    State                  : disconnected\n'
    : process.platform === 'darwin'
      ? 'You are not associated with an AirPort network.\n'
      : '\n';

const succeeds = (stdout) => (cb) => cb(null, stdout);
const fails = () => (cb) => cb(new Error('command not found'));

beforeEach(() => {
  _resetNetworkNameCache();
  probe.calls = 0;
  probe.behaviour = succeeds(CONNECTED);
});

describe('getNetworkName', () => {
  it('returns a value, never a promise — a request must not await the OS', () => {
    const v = getNetworkName();
    expect(v).not.toBeInstanceOf(Promise);
    expect(v === null || typeof v === 'string').toBe(true);
  });

  it('answers immediately on a cold cache instead of waiting for the probe', () => {
    const started = Date.now();
    const v = getNetworkName();
    expect(Date.now() - started).toBeLessThan(5);
    expect(v).toBeNull(); // nothing known yet — the same fallback as a wired machine
  });

  it('does not even SPAWN during the read — execFile itself costs ~8ms', async () => {
    getNetworkName();
    expect(probe.calls).toBe(0); // nothing started while the response is being written

    await new Promise((r) => setImmediate(r));
    expect(probe.calls).toBe(1); // ...and exactly one starts straight after
  });

  it('serves the real name once the background probe settles', async () => {
    getNetworkName();
    await primeNetworkName();
    expect(getNetworkName()).toBe('Example Network 5G');
  });

  it('collapses a burst of polls into a single OS call', async () => {
    for (let i = 0; i < 25; i++) getNetworkName();
    await primeNetworkName();
    await new Promise((r) => setImmediate(r)); // let any queued probe run too
    expect(probe.calls).toBe(1);
  });

  it('does not re-probe while the cache is fresh', async () => {
    await primeNetworkName();
    const after = probe.calls;
    for (let i = 0; i < 10; i++) getNetworkName();
    expect(probe.calls).toBe(after);
  });

  it('keeps the known name when a later probe fails', async () => {
    await primeNetworkName();
    expect(getNetworkName()).toBe('Example Network 5G');

    // A momentarily busy or missing command is the absence of evidence, not
    // evidence of absence. Blanking here would tell the user to join a network
    // we simply failed to ask about.
    probe.behaviour = fails();
    await forceRefresh();
    expect(getNetworkName()).toBe('Example Network 5G');
  });

  it('clears the name when the probe succeeds and reports no Wi-Fi', async () => {
    await primeNetworkName();
    expect(getNetworkName()).toBe('Example Network 5G');

    // This one IS evidence: we asked, and this machine is not on Wi-Fi.
    probe.behaviour = succeeds(NO_WIFI);
    await forceRefresh();
    expect(getNetworkName()).toBeNull();
  });

  it('backs off rather than spawning a process per request when probing fails', async () => {
    probe.behaviour = fails();
    await primeNetworkName();
    const after = probe.calls;
    for (let i = 0; i < 10; i++) getNetworkName();
    expect(probe.calls).toBe(after);
  });
});

/**
 * Expire the TTL without waiting 60 real seconds, then let the refresh settle.
 * Uses fake time only for the staleness check, so the probe itself still runs
 * on real timers.
 */
async function forceRefresh() {
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    getNetworkName(); // observes staleness, starts the probe
    await primeNetworkName(); // joins the in-flight probe
  } finally {
    Date.now = realNow;
  }
}
