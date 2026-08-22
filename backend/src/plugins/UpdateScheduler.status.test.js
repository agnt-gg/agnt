/**
 * Updates apply themselves; exactly one thing reaches the user.
 *
 * WHY THIS EXISTS
 * ---------------
 * This scheduler used to default to OFF, with a per-plugin policy of
 * "auto" | "notify" | "pinned" where "notify" — the DEFAULT — recorded its
 * finding to update-status.json, a file that no route served and no client
 * read. Three switches, all wired to "do nothing".
 *
 * It now runs by default and takes every update that is not pinned. The thing
 * that makes that safe rather than reckless is a single invariant:
 *
 *     an auto-update calls updatePlugin() WITHOUT acceptedPermissions
 *
 * so the permission-diff gate refuses anything that would widen a plugin's
 * powers, changes nothing on disk, and records the refusal. Silence is
 * therefore only ever granted to an update that asked for nothing new. If that
 * invariant breaks, deleting the UI controls was the wrong call — so it is
 * asserted here from several directions.
 *
 * The scheduler only touches its installer through `registryPath`,
 * `checkForUpdates()` and `updatePlugin()`, so a stub installer exercises the
 * real code path with no filesystem beyond a temp dir and no network at all.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import UpdateScheduler from './UpdateScheduler.js';

let TMP;

function stubInstaller({ registry = { plugins: [] }, updates = [], onUpdate } = {}) {
  const calls = [];
  return {
    calls,
    registryPath: path.join(TMP, 'registry.json'),
    async checkForUpdates() {
      return { success: true, updates };
    },
    async updatePlugin(name, options) {
      calls.push({ name, options });
      return onUpdate ? onUpdate(name) : { success: true, version: '2.0.0' };
    },
    _writeRegistry: () => fs.writeFile(path.join(TMP, 'registry.json'), JSON.stringify(registry)),
  };
}

/**
 * A scheduler whose live-activation step is recorded instead of performed.
 * The real one reloads the plugin manager, the orchestrator registry and the
 * forked workflow child — none of which belong in a unit test.
 */
function makeScheduler(installer) {
  const scheduler = new UpdateScheduler(installer);
  scheduler.activated = [];
  scheduler.activateUpdate = async (name, version) => {
    scheduler.activated.push({ name, version });
  };
  return scheduler;
}

beforeEach(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-update-status-'));
});

afterEach(async () => {
  // Only one test fakes the clock, but restoring it here means a failure inside
  // that test cannot leak a frozen Date into everything that follows.
  vi.useRealTimers();
  await fs.rm(TMP, { recursive: true, force: true });
});

describe('the scheduler runs by default', () => {
  it('starts with no settings file at all', async () => {
    const scheduler = makeScheduler(stubInstaller());
    await expect(scheduler.start()).resolves.toBe(true);
    scheduler.stop();
  });

  it('defaults to checking every 6 hours', async () => {
    const scheduler = makeScheduler(stubInstaller());
    await expect(scheduler.getSettings()).resolves.toEqual({ autoCheck: true, intervalHours: 6 });
  });

  it('honours autoCheck:false in the file-only escape hatch', async () => {
    // There is deliberately no UI and no route for this. It exists so a power
    // user is not trapped, not as a question to put on screen.
    const scheduler = makeScheduler(stubInstaller());
    await fs.writeFile(scheduler.settingsPath, JSON.stringify({ autoCheck: false }));
    await expect(scheduler.start()).resolves.toBe(false);
  });

  it('never holds the process open', async () => {
    // Now that this starts on every boot, a timer that keeps the event loop
    // alive would hang every short-lived process that touches the installer.
    const scheduler = makeScheduler(stubInstaller());
    await scheduler.start();
    expect(scheduler.timer.hasRef()).toBe(false);
    expect(scheduler.bootTimer.hasRef()).toBe(false);
    scheduler.stop();
  });

  it('stop() clears the boot timer as well as the interval', async () => {
    const scheduler = makeScheduler(stubInstaller());
    await scheduler.start();
    scheduler.stop();
    expect(scheduler.timer).toBeNull();
    expect(scheduler.bootTimer).toBeNull();
  });
});

describe('what a pass does', () => {
  it('updates a plugin with no policy at all — the default is now to update', async () => {
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'weather' }] },
      updates: [{ name: 'weather', installed: '1.0.0', latest: '1.4.0', updateAvailable: true }],
      onUpdate: () => ({ success: true, version: '1.4.0' }),
    });
    await installer._writeRegistry();
    const scheduler = makeScheduler(installer);

    const summary = await scheduler.tick();

    expect(summary.autoUpdated).toEqual([{ name: 'weather', version: '1.4.0' }]);
    // THE INVARIANT: silence is only ever granted to an update that asked for
    // nothing new, because consent is never pre-granted here.
    expect(installer.calls[0].options).toEqual({ acceptedPermissions: false });
  });

  it('treats a legacy "notify" entry as the new default rather than as pinned', async () => {
    // "notify" was the old default and it notified nobody, so nobody chose it
    // for what it did. Reading it as "do not update" would preserve the bug.
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'weather', updatePolicy: 'notify' }] },
      updates: [{ name: 'weather', installed: '1.0.0', latest: '1.4.0', updateAvailable: true }],
      onUpdate: () => ({ success: true, version: '1.4.0' }),
    });
    await installer._writeRegistry();
    const scheduler = makeScheduler(installer);

    const summary = await scheduler.tick();

    expect(summary.autoUpdated).toEqual([{ name: 'weather', version: '1.4.0' }]);
  });

  it('never reports or touches a pinned plugin', async () => {
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'frozen', updatePolicy: 'pinned' }] },
      updates: [{ name: 'frozen', installed: '1.0.0', latest: '9.9.9', updateAvailable: true }],
    });
    await installer._writeRegistry();
    const scheduler = makeScheduler(installer);

    const summary = await scheduler.tick();

    expect([...summary.autoUpdated, ...summary.blockedOnConsent, ...summary.failed]).toEqual([]);
    expect(installer.calls).toEqual([]);
    expect(scheduler.activated).toEqual([]);
    // Still counted: pinned means "do not act", not "do not see".
    expect(summary.updatesAvailable).toBe(1);
  });

  it('refuses an escalating update and records WHICH permissions caused it', async () => {
    // Without the diff the chip could only say "something was blocked", and
    // the user would have no basis on which to decide anything.
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'scraper' }] },
      updates: [{ name: 'scraper', installed: '1.0.0', latest: '2.0.0', updateAvailable: true }],
      onUpdate: () => ({
        success: false,
        requiresConsent: true,
        permissionDiff: { added: ['filesystem', 'spawn-process'] },
      }),
    });
    await installer._writeRegistry();
    const scheduler = makeScheduler(installer);

    const summary = await scheduler.tick();

    expect(summary.blockedOnConsent).toHaveLength(1);
    expect(summary.blockedOnConsent[0].name).toBe('scraper');
    expect(summary.blockedOnConsent[0].permissionDiff.added).toEqual(['filesystem', 'spawn-process']);
    expect(summary.autoUpdated).toEqual([]);
    // Nothing changed on disk, so nothing may be activated in the live process.
    expect(scheduler.activated).toEqual([]);
  });

  it('records a failure so a silently broken plugin is still visible', async () => {
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'flaky' }] },
      updates: [{ name: 'flaky', installed: '1.0.0', latest: '1.2.0', updateAvailable: true }],
      onUpdate: () => ({ success: false, error: 'download failed: 502' }),
    });
    await installer._writeRegistry();
    const scheduler = makeScheduler(installer);

    const summary = await scheduler.tick();

    expect(summary.failed).toEqual([{ name: 'flaky', error: 'download failed: 502' }]);
    expect(scheduler.activated).toEqual([]);
  });

  it('ignores a plugin that has no update', async () => {
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'weather' }] },
      updates: [{ name: 'weather', installed: '1.0.0', latest: '1.0.0', updateAvailable: false }],
    });
    await installer._writeRegistry();
    const scheduler = makeScheduler(installer);

    const summary = await scheduler.tick();

    expect(summary.updatesAvailable).toBe(0);
    expect(installer.calls).toEqual([]);
  });
});

describe('a completed update is made live, not just written to disk', () => {
  it('activates after a successful auto-update', async () => {
    // updatePlugin() only changes the disk. The main process, the orchestrator
    // and the forked workflow child each hold their own loaded copy, and the
    // HTTP route reloads all three on the way out — a path this never takes.
    // Without activation the registry says v1.1.0 while every execution still
    // runs v1.0.0 until restart.
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'notes' }] },
      updates: [{ name: 'notes', installed: '1.0.0', latest: '1.1.0', updateAvailable: true }],
      onUpdate: () => ({ success: true, version: '1.1.0' }),
    });
    await installer._writeRegistry();
    const scheduler = makeScheduler(installer);

    await scheduler.tick();

    expect(scheduler.activated).toEqual([{ name: 'notes', version: '1.1.0' }]);
  });

  it('does not fail the pass when activation throws', async () => {
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'notes' }] },
      updates: [{ name: 'notes', installed: '1.0.0', latest: '1.1.0', updateAvailable: true }],
      onUpdate: () => ({ success: true, version: '1.1.0' }),
    });
    await installer._writeRegistry();
    const scheduler = new UpdateScheduler(installer);
    scheduler.activateUpdate = async () => {
      throw new Error('workflow child is down');
    };

    // The update already succeeded on disk. A reload failure is a degraded
    // state to log, not a reason to lose the record of what happened.
    const summary = await scheduler.tick();
    expect(summary.autoUpdated).toEqual([{ name: 'notes', version: '1.1.0' }]);
  });
});

describe('UpdateScheduler.getStatus', () => {
  it('reports null before any pass has run', async () => {
    expect(await makeScheduler(stubInstaller()).getStatus()).toBeNull();
  });

  it('reports null for an unreadable file instead of throwing', async () => {
    // A half-written file after a crash must read as "nothing to report", not
    // as a 500 on the route that serves it.
    const scheduler = makeScheduler(stubInstaller());
    await fs.writeFile(scheduler.statusPath, '{"checkedAt": "2026-');
    await expect(scheduler.getStatus()).resolves.toBeNull();
  });

  it('reports null for valid JSON that is not an object', async () => {
    const scheduler = makeScheduler(stubInstaller());
    await fs.writeFile(scheduler.statusPath, 'null');
    expect(await scheduler.getStatus()).toBeNull();
  });

  it('reads back exactly what the pass decided', async () => {
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'weather' }] },
      updates: [{ name: 'weather', installed: '1.0.0', latest: '1.4.0', updateAvailable: true }],
      onUpdate: () => ({ success: true, version: '1.4.0' }),
    });
    await installer._writeRegistry();
    const scheduler = makeScheduler(installer);

    const written = await scheduler.tick();
    expect(await scheduler.getStatus()).toEqual(written);
  });

  it('replaces the previous pass rather than accumulating', async () => {
    // The clock is faked because `checkedAt` is
    // `new Date().toISOString()` — millisecond resolution. The two ticks below
    // run back to back with nothing slow between them, so on a fast machine
    // both land in the SAME millisecond and the timestamps come out identical.
    // The old assertion was `not.toBe`, which therefore passed only when
    // something happened to be slow enough, and failed intermittently in CI
    // while passing in isolation.
    //
    // Faking Date alone — not setTimeout/setInterval — keeps the scheduler's
    // real async filesystem work untouched; there is nothing here to advance.
    vi.useFakeTimers({ toFake: ['Date'] });
    const firstPassAt = new Date('2026-01-01T00:00:00.000Z');
    const secondPassAt = new Date('2026-01-01T06:00:00.000Z');

    const installer = stubInstaller({
      registry: { plugins: [{ name: 'weather' }] },
      updates: [{ name: 'weather', installed: '1.0.0', latest: '1.4.0', updateAvailable: true }],
      onUpdate: () => ({ success: true, version: '1.4.0' }),
    });
    await installer._writeRegistry();
    const scheduler = makeScheduler(installer);

    vi.setSystemTime(firstPassAt);
    await scheduler.tick();
    const first = await scheduler.getStatus();

    installer.checkForUpdates = async () => ({ success: true, updates: [] });
    vi.setSystemTime(secondPassAt);
    await scheduler.tick();
    const second = await scheduler.getStatus();

    expect(second.autoUpdated).toEqual([]);
    expect(second.updatesAvailable).toBe(0);

    // Now that the clock is controlled this can assert the exact values rather
    // than merely that they differ — which also pins the direction, so a
    // summary that carried the OLD timestamp forward fails here too.
    expect(first.checkedAt).toBe(firstPassAt.toISOString());
    expect(second.checkedAt).toBe(secondPassAt.toISOString());
  });
});

describe('the routes that back this', () => {
  // These handlers are a few lines each and live on a router that drags in the
  // plugin manager, the workflow bridge and the orchestrator tool registry, so
  // they are asserted at the source.
  let source;

  beforeEach(async () => {
    source = await fs.readFile(path.join(import.meta.dirname, '..', 'routes', 'PluginRoutes.js'), 'utf-8');
  });

  it('serves the status through getStatus(), behind auth', () => {
    const handler = /router\.get\('\/update-status',([\s\S]*?)\n\}\);/.exec(source);
    expect(handler, 'GET /update-status is not registered').not.toBeNull();
    expect(handler[1]).toMatch(/requireAuthHeader/);
    expect(handler[1]).toMatch(/updateScheduler\.getStatus\(\)/);
    expect(handler[1]).not.toMatch(/update-status\.json/);
  });

  it('exposes no update-settings route in either direction', () => {
    // Whether to check for updates is not a question a user can answer better
    // than the program can. A route here is what put a checkbox on screen.
    expect(source).not.toMatch(/router\.(get|post)\('\/update-settings'/);
  });

  it('accepts only the binary policy', () => {
    const handler = /router\.post\('\/update-policy\/:name',([\s\S]*?)\n\}\);/.exec(source);
    expect(handler, 'POST /update-policy/:name is not registered').not.toBeNull();
    expect(handler[1]).toMatch(/\['auto', 'pinned'\]/);
    expect(handler[1]).not.toMatch(/'notify'/);
  });
});
