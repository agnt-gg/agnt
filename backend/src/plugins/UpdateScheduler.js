/**
 * UpdateScheduler — trust system W8: background update checks + gated auto-update.
 *
 * Defaults OFF. Settings live at %USER_DATA%/plugins/update-settings.json:
 *   { "autoCheck": false, "intervalHours": 24 }
 * Per-plugin policy lives on the registry entry (merge semantics preserve):
 *   updatePolicy: "auto" | "notify" (default) | "pinned"
 *
 * The safety invariant does the heavy lifting: an auto-update runs through
 * updatePlugin() WITHOUT acceptedPermissions, so any permission escalation
 * is blocked by the diff gate and downgraded to a notification. Auto-update
 * can never expand a plugin's powers silently. Pinned plugins and
 * unknown-version plugins are never touched.
 */

import fs from 'fs/promises';
import path from 'path';

class UpdateScheduler {
  constructor(installer) {
    this.installer = installer;
    this.timer = null;
    this.isRunning = false;
    this.settingsPath = path.join(path.dirname(installer.registryPath), 'update-settings.json');
    this.statusPath = path.join(path.dirname(installer.registryPath), 'update-status.json');
  }

  async getSettings() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.settingsPath, 'utf-8'));
      return { autoCheck: false, intervalHours: 24, ...parsed };
    } catch {
      return { autoCheck: false, intervalHours: 24 };
    }
  }

  async setSettings(patch) {
    const merged = { ...(await this.getSettings()), ...patch };
    await fs.writeFile(this.settingsPath, JSON.stringify(merged, null, 2));
    // React immediately: start/stop the loop to match the new setting.
    if (merged.autoCheck) await this.start();
    else this.stop();
    return merged;
  }

  async start() {
    const settings = await this.getSettings();
    if (!settings.autoCheck) {
      console.log('[UpdateScheduler] autoCheck disabled — not starting (enable via update-settings)');
      return false;
    }
    if (this.timer) return true;
    const intervalMs = Math.max(1, settings.intervalHours) * 60 * 60 * 1000;
    console.log(`[UpdateScheduler] Starting — checking every ${settings.intervalHours}h`);
    // First tick 2 minutes after boot; don't pile onto startup.
    setTimeout(() => this.tick(), 2 * 60 * 1000);
    this.timer = setInterval(() => this.tick(), intervalMs);
    return true;
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[UpdateScheduler] Stopped');
    }
  }

  /**
   * The last pass's summary, or null if a pass has never run.
   *
   * tick() has always written this file and nothing has ever read it back, so
   * the two facts only it records were unobservable: what was updated without
   * the user asking, and — the one that matters — what was REFUSED because the
   * new version wanted permissions the installed one did not have. That second
   * one is a security-relevant event about a plugin already on the machine,
   * and its entire audience was a console.warn.
   *
   * Returns null rather than throwing on a missing or corrupt file: "no pass
   * has run" and "the file is unreadable" are both correctly rendered as
   * "nothing to report", and neither should fail the request.
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
   * One scheduler pass. Returns a summary (also persisted to statusPath):
   * { checkedAt, updatesAvailable, autoUpdated, blockedOnConsent, notified }
   */
  async tick() {
    if (this.isRunning) return null;
    this.isRunning = true;
    const summary = { checkedAt: new Date().toISOString(), updatesAvailable: 0, autoUpdated: [], blockedOnConsent: [], notified: [] };
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
        const policy = entry?.updatePolicy || 'notify';

        if (policy === 'pinned') continue;
        if (policy !== 'auto') {
          summary.notified.push({ name: u.name, installed: u.installed, latest: u.latest });
          continue;
        }

        // AUTO: run WITHOUT acceptedPermissions — the permission-diff gate
        // converts any escalation into a notification. This is the invariant.
        const result = await this.installer.updatePlugin(u.name, { acceptedPermissions: false });
        if (result.success) {
          summary.autoUpdated.push({ name: u.name, version: result.version });
          console.log(`[UpdateScheduler] Auto-updated ${u.name} → ${result.version}`);
        } else if (result.requiresConsent) {
          summary.blockedOnConsent.push({ name: u.name, permissionDiff: result.permissionDiff });
          console.warn(`[UpdateScheduler] ${u.name}: auto-update blocked — requests new permissions (${result.permissionDiff?.added?.join(', ')})`);
        } else {
          summary.notified.push({ name: u.name, error: result.error });
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
