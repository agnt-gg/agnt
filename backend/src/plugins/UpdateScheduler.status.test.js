/**
 * The scheduler's summary was write-only.
 *
 * WHY THIS EXISTS
 * ---------------
 * `tick()` ends with:
 *
 *     await fs.writeFile(this.statusPath, JSON.stringify(summary, null, 2))
 *
 * and that was the end of the road. Repository-wide, the only thing that ever
 * touched `update-status.json` again was a test asserting the file exists.
 * No method read it, no route served it, no client fetched it.
 *
 * That made two facts unobservable to the person who owns the machine:
 *
 *   - `notified` — which is what the DEFAULT policy produces. A plugin under
 *     `notify` has an update, the scheduler dutifully records it, and the
 *     record is never shown to anyone. The default policy notified nobody.
 *
 *   - `blockedOnConsent` — an auto-update that was REFUSED because the new
 *     version asked for permissions the installed one did not have. That is a
 *     security-relevant event about code already on the machine, and its whole
 *     audience was a `console.warn` in a log nobody tails.
 *
 * `getStatus()` is the read side. These tests pin the round trip: what tick()
 * decided is what a caller can later read back, including the permission diff
 * that explains the refusal.
 *
 * The scheduler only ever touches its installer through `registryPath`,
 * `checkForUpdates()` and `updatePlugin()`, so a stub installer exercises the
 * real code path with no filesystem beyond a temp dir and no network at all.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import UpdateScheduler from './UpdateScheduler.js';

let TMP;

/**
 * @param registry  contents of registry.json — carries each plugin's updatePolicy
 * @param updates   what checkForUpdates() reports
 * @param onUpdate  stands in for updatePlugin(); receives the plugin name
 */
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

beforeEach(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'agnt-update-status-'));
});

afterEach(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});

describe('UpdateScheduler.getStatus', () => {
  it('reports null before any pass has run', async () => {
    const scheduler = new UpdateScheduler(stubInstaller());
    expect(await scheduler.getStatus()).toBeNull();
  });

  it('reports null for an unreadable file instead of throwing', async () => {
    // A half-written file after a crash must render as "nothing to report",
    // not as a 500 on the route that serves it.
    const scheduler = new UpdateScheduler(stubInstaller());
    await fs.writeFile(scheduler.statusPath, '{"checkedAt": "2026-');
    await expect(scheduler.getStatus()).resolves.toBeNull();
  });

  it('reports null for valid JSON that is not an object', async () => {
    const scheduler = new UpdateScheduler(stubInstaller());
    await fs.writeFile(scheduler.statusPath, 'null');
    expect(await scheduler.getStatus()).toBeNull();
  });

  it('reads back what the notify policy recorded — the default policy is now observable', async () => {
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'weather', updatePolicy: 'notify' }] },
      updates: [{ name: 'weather', installed: '1.0.0', latest: '1.4.0', updateAvailable: true }],
    });
    await installer._writeRegistry();
    const scheduler = new UpdateScheduler(installer);

    const written = await scheduler.tick();
    const read = await scheduler.getStatus();

    // The whole point: the read side sees exactly what the write side decided.
    expect(read).toEqual(written);
    expect(read.notified).toEqual([{ name: 'weather', installed: '1.0.0', latest: '1.4.0' }]);
    expect(read.updatesAvailable).toBe(1);
    // notify must not install anything.
    expect(installer.calls).toEqual([]);
  });

  it('reads back a refused auto-update WITH the permissions that caused the refusal', async () => {
    // The escalation invariant in tick() is only useful if the user can find
    // out it fired. Without the diff the row would say "something was blocked"
    // and the user would have no basis to decide anything.
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'scraper', updatePolicy: 'auto' }] },
      updates: [{ name: 'scraper', installed: '1.0.0', latest: '2.0.0', updateAvailable: true }],
      onUpdate: () => ({
        success: false,
        requiresConsent: true,
        permissionDiff: { added: ['filesystem', 'spawn-process'] },
      }),
    });
    await installer._writeRegistry();
    const scheduler = new UpdateScheduler(installer);

    await scheduler.tick();
    const read = await scheduler.getStatus();

    expect(read.blockedOnConsent).toHaveLength(1);
    expect(read.blockedOnConsent[0].name).toBe('scraper');
    expect(read.blockedOnConsent[0].permissionDiff.added).toEqual(['filesystem', 'spawn-process']);
    expect(read.autoUpdated).toEqual([]);
  });

  it('reads back a completed auto-update and its new version', async () => {
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'notes', updatePolicy: 'auto' }] },
      updates: [{ name: 'notes', installed: '1.0.0', latest: '1.1.0', updateAvailable: true }],
      onUpdate: () => ({ success: true, version: '1.1.0' }),
    });
    await installer._writeRegistry();
    const scheduler = new UpdateScheduler(installer);

    await scheduler.tick();
    const read = await scheduler.getStatus();

    expect(read.autoUpdated).toEqual([{ name: 'notes', version: '1.1.0' }]);
    // The invariant that makes unattended updates safe: no accepted permissions.
    expect(installer.calls[0].options).toEqual({ acceptedPermissions: false });
  });

  it('reads back an update failure so a silently broken plugin is visible', async () => {
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'flaky', updatePolicy: 'auto' }] },
      updates: [{ name: 'flaky', installed: '1.0.0', latest: '1.2.0', updateAvailable: true }],
      onUpdate: () => ({ success: false, error: 'download failed: 502' }),
    });
    await installer._writeRegistry();
    const scheduler = new UpdateScheduler(installer);

    await scheduler.tick();
    const read = await scheduler.getStatus();

    expect(read.notified).toEqual([{ name: 'flaky', error: 'download failed: 502' }]);
  });

  it('never reports a pinned plugin, in any bucket', async () => {
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'frozen', updatePolicy: 'pinned' }] },
      updates: [{ name: 'frozen', installed: '1.0.0', latest: '9.9.9', updateAvailable: true }],
    });
    await installer._writeRegistry();
    const scheduler = new UpdateScheduler(installer);

    await scheduler.tick();
    const read = await scheduler.getStatus();

    const everyBucket = [...read.notified, ...read.autoUpdated, ...read.blockedOnConsent];
    expect(everyBucket).toEqual([]);
    expect(installer.calls).toEqual([]);
    // Still counted as available — pinned means "do not act", not "do not see".
    expect(read.updatesAvailable).toBe(1);
  });

  it('replaces the previous pass rather than accumulating', async () => {
    const installer = stubInstaller({
      registry: { plugins: [{ name: 'weather', updatePolicy: 'notify' }] },
      updates: [{ name: 'weather', installed: '1.0.0', latest: '1.4.0', updateAvailable: true }],
    });
    await installer._writeRegistry();
    const scheduler = new UpdateScheduler(installer);

    await scheduler.tick();
    const first = await scheduler.getStatus();

    // Second pass: nothing to report anymore.
    installer.checkForUpdates = async () => ({ success: true, updates: [] });
    await scheduler.tick();
    const second = await scheduler.getStatus();

    expect(second.notified).toEqual([]);
    expect(second.updatesAvailable).toBe(0);
    expect(second.checkedAt).not.toBe(first.checkedAt);
  });
});

describe('the route that serves it', () => {
  // The handler is three lines and lives on a router that drags in the plugin
  // manager, the workflow bridge and the orchestrator tool registry, so it is
  // asserted at the source. What matters is that the endpoint exists, is
  // behind the same auth guard as its neighbours, and answers from getStatus()
  // rather than re-reading the file with its own copy of the path.
  it('is registered, auth-guarded, and reads through getStatus()', async () => {
    const source = await fs.readFile(path.join(import.meta.dirname, '..', 'routes', 'PluginRoutes.js'), 'utf-8');

    const handler = /router\.get\('\/update-status',([\s\S]*?)\n\}\);/.exec(source);
    expect(handler, 'GET /update-status is not registered').not.toBeNull();
    expect(handler[1]).toMatch(/requireAuthHeader/);
    expect(handler[1]).toMatch(/updateScheduler\.getStatus\(\)/);
    expect(handler[1]).not.toMatch(/update-status\.json/);
  });
});
