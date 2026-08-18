/**
 * UpdateScheduler — plugin updates are infrastructure, not a decision.
 *
 * Runs by default. Applies anything that does not widen a plugin's powers.
 * The user hears about exactly one thing: an update REFUSED because the new
 * version asked for more than the installed one had.
 *
 * WHY IT WORKS THIS WAY
 * ---------------------
 * This used to default to OFF, with a per-plugin `updatePolicy` of
 * "auto" | "notify" | "pinned" where "notify" was the default. So out of the
 * box nothing checked, and if you turned checking on, the default policy
 * recorded the finding to a file nothing read. Three switches, all wired to
 * "do nothing", presented to a user who has no information the app lacks —
 * nobody can answer "is now a good time to poll a JSON file?" better than the
 * program can. Chrome, Figma and Slack ship no such controls; VS Code defaults
 * its one setting to on and keeps it out of the extensions view.
 *
 * Policy is now binary and lives in a per-plugin overflow menu:
 *   pinned   → never touched
 *   anything else (default) → updated as soon as an update exists
 * A legacy "notify" entry therefore reads as the new default, which is right:
 * "notify" never notified anyone, so nobody chose it for what it did.
 *
 * WHAT MAKES SILENT SAFE
 * ----------------------
 * An auto-update calls updatePlugin() WITHOUT acceptedPermissions, so the
 * permission-diff gate turns any escalation into a refusal that changes
 * nothing on disk. Silence is therefore only ever granted to an update that
 * asked for nothing new. That invariant is the whole basis for deleting the
 * controls, and it is asserted in UpdateScheduler.status.test.js.
 *
 * Settings still live at %USER_DATA%/plugins/update-settings.json
 * ({ autoCheck, intervalHours }) as a file-only escape hatch. There is
 * deliberately no UI for it.
 */

import fs from 'fs/promises';
import path from 'path';

const DEFAULT_SETTINGS = { autoCheck: true, intervalHours: 6 };

class UpdateScheduler {
  constructor(installer) {
    this.installer = installer;
    this.timer = null;
    this.bootTimer = null;
    this.isRunning = false;
    this.settingsPath = path.join(path.dirname(installer.registryPath), 'update-settings.json');
    this.statusPath = path.join(path.dirname(installer.registryPath), 'update-status.json');
  }

  async getSettings() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.settingsPath, 'utf-8'));
      return { ...DEFAULT_SETTINGS, ...parsed };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async setSettings(patch) {
    const merged = { ...(await this.getSettings()), ...patch };
    await fs.writeFile(this.settingsPath, JSON.stringify(merged, null, 2));
    if (merged.autoCheck) await this.start();
    else this.stop();
    return merged;
  }

  async start() {
    const settings = await this.getSettings();
    if (!settings.autoCheck) {
      console.log('[UpdateScheduler] autoCheck disabled in update-settings.json — not starting');
      return false;
    }
    if (this.timer) return true;
    const intervalMs = Math.max(1, settings.intervalHours) * 60 * 60 * 1000;
    console.log(`[UpdateScheduler] Starting — checking every ${settings.intervalHours}h`);
    // First tick 2 minutes after boot; don't pile onto startup.
    this.bootTimer = setTimeout(() => this.tick(), 2 * 60 * 1000);
    this.timer = setInterval(() => this.tick(), intervalMs);
    // A background chore must never be the reason the process stays alive.
    // Now that this runs by default, an un-unref'd timer would hold open every
    // short-lived process that boots the installer, tests included.
    this.bootTimer.unref?.();
    this.timer.unref?.();
    return true;
  }

  stop() {
    if (this.bootTimer) {
      clearTimeout(this.bootTimer);
      this.bootTimer = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[UpdateScheduler] Stopped');
    }
  }

  /**
   * The last pass's summary, or null if a pass has never run.
   *
   * Returns null rather than throwing on a missing or corrupt file: "no pass
   * has run" and "the file is unreadable" both correctly render as "nothing to
   * report", and neither should fail the request that reads it.
   */
  async getStatus() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statusPath, 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  /**
   * Make a completed update live in the processes already running.
   *
   * updatePlugin() only changes the disk. The main process, the orchestrator
   * and the forked workflow child each hold their own loaded copy, and the
   * HTTP route reloads all three on the way out — a path a background update
   * never takes. Without this the registry says v2 while every execution still
   * runs v1 until restart.
   *
   * Overridable, and lazily imported, so a unit test can observe the call
   * without dragging the workflow bridge into the test process. Never throws:
   * a failed reload is a degraded state to log, not a reason to fail the pass
   * that already succeeded on disk.
   */
  async activateUpdate(name, version) {
    try {
      const [{ default: reloadAllPlugins }, { broadcast, RealtimeEvents }] = await Promise.all([
        import('./reloadAllPlugins.js'),
        import('../utils/realtimeSync.js'),
      ]);
      await reloadAllPlugins();
      broadcast(RealtimeEvents.PLUGIN_INSTALLED, {
        name,
        version,
        updated: true,
        automatic: true,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(`[UpdateScheduler] ${name} updated on disk but could not be activated live:`, err.message);
    }
  }

  /**
   * One scheduler pass. Returns a summary (also persisted to statusPath):
   * { checkedAt, updatesAvailable, autoUpdated, blockedOnConsent, failed }
   *
   * `failed` was called `notified` when a "notify" policy existed; only its
   * error entries were ever meaningful, and readers still tolerate the old key.
   */
  async tick() {
    if (this.isRunning) return null;
    this.isRunning = true;
    const summary = { checkedAt: new Date().toISOString(), updatesAvailable: 0, autoUpdated: [], blockedOnConsent: [], failed: [] };
    try {
      const check = await this.installer.checkForUpdates();
      if (!check.success) throw new Error(check.error || 'checkForUpdates failed');

      let registry = { plugins: [] };
      try {
        registry = JSON.parse(await fs.readFile(this.installer.registryPath, 'utf-8'));
      } catch {}

      for (const u of check.updates) {
        if (!u.updateAvailable) continue;
        summary.updatesAvailable++;
        const entry = (registry.plugins || []).find((p) => p.name === u.name);

        // Pinned is the only opt-out, and it is absolute. Everything else —
        // including a legacy "notify" entry — takes the update.
        if (entry?.updatePolicy === 'pinned') continue;

        // Run WITHOUT acceptedPermissions: the permission-diff gate converts
        // any escalation into a refusal. This is the invariant that earns the
        // right to do this silently.
        const result = await this.installer.updatePlugin(u.name, { acceptedPermissions: false });
        if (result.success) {
          summary.autoUpdated.push({ name: u.name, version: result.version });
          console.log(`[UpdateScheduler] Auto-updated ${u.name} → ${result.version}`);
          await this.activateUpdate(u.name, result.version);
        } else if (result.requiresConsent) {
          summary.blockedOnConsent.push({ name: u.name, permissionDiff: result.permissionDiff });
          console.warn(`[UpdateScheduler] ${u.name}: auto-update blocked — requests new permissions (${result.permissionDiff?.added?.join(', ')})`);
        } else {
          summary.failed.push({ name: u.name, error: result.error });
        }
      }

      await fs.writeFile(this.statusPath, JSON.stringify(summary, null, 2)).catch(() => {});
      return summary;
    } catch (err) {
      console.error('[UpdateScheduler] tick failed:', err.message);
      summary.error = err.message;
      return summary;
    } finally {
      this.isRunning = false;
    }
  }
}

export default UpdateScheduler;
