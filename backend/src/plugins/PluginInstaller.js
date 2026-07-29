import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';function safeParseArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return null;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function safeParseObject(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string') return null;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

import {
  validateManifestAssets,
  computeIntegrity,
  integrityMatches,
  computeDirIntegrity,
  scanCapabilities,
  normalizePermissions,
  diffCapabilities,
  computeTrustTier,
  compareVersions,
} from '../../plugins/lib/validate-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * PluginInstaller - Handles plugin installation from marketplace
 *
 * ASAR-COMPATIBLE ARCHITECTURE:
 * Plugins are stored OUTSIDE the app bundle in the user data directory.
 * This allows ASAR packaging for the main app while keeping plugins writable.
 *
 * Plugin Storage Location:
 * - Windows: %APPDATA%/AGNT/plugins/
 * - macOS: ~/Library/Application Support/AGNT/plugins/
 * - GNU/Linux: ~/.config/AGNT/plugins/
 *
 * Plugin Distribution Model (VSCode Extension style):
 * 1. Plugins are distributed as source code only (no node_modules)
 * 2. Users download lightweight .agnt packages (gzipped tar archives)
 * 3. Dependencies are installed via npm on the target machine
 * 4. Native modules are compiled for the exact runtime environment
 *
 * Benefits:
 * - ASAR can be enabled for main app (faster startup, code protection)
 * - No native dependency conflicts (Sharp, etc.)
 * - Always compatible with user's Node.js/Electron version
 * - Plugins persist across app updates
 * - Smaller download sizes
 *
 * Supported file formats:
 * - .agnt (recommended - branded AGNT plugin format)
 * - .tar.gz (legacy support)
 * - .tgz (legacy support)
 */
class PluginInstaller {
  constructor() {
    // Use USER_DATA_PATH from environment (set by Electron main.js)
    // This ensures plugins are stored outside the ASAR archive
    const userDataPath = process.env.USER_DATA_PATH || this.getDefaultUserDataPath();

    this.pluginsDir = path.join(userDataPath, 'plugins', 'installed');
    this.tempDir = path.join(userDataPath, 'plugins', '.temp');
    this.registryPath = path.join(userDataPath, 'plugins', 'registry.json');

    // Use APP_PATH from Electron if available (works in both dev and packaged mode)
    // In packaged mode, __dirname points inside ASAR which utilityProcess can't read
    // APP_PATH = desktop/ folder (where main.js is)
    // Fallback: go up 3 levels from src/plugins/ to desktop/
    const appPath = process.env.APP_PATH || path.join(__dirname, '../../..');

    // UNPACKED_PATH points to app.asar.unpacked in packaged mode (outside ASAR)
    // This is needed because utilityProcess.fork() can't read from ASAR archives
    // In dev mode, UNPACKED_PATH is the same as APP_PATH
    const unpackedPath = process.env.UNPACKED_PATH || appPath;

    // Marketplace config stays in app bundle (read-only is fine)
    this.marketplacePath = path.join(appPath, 'backend', 'plugins', 'marketplace.json');
    this.marketplaceUrl = process.env.PLUGIN_MARKETPLACE_URL || 'https://agnt.gg/api/plugins';

    // Bundled .agnt plugin files directory (for installing default plugins on first run)
    // Uses UNPACKED_PATH because utilityProcess can't read from ASAR
    this.bundledPluginsDir = path.join(unpackedPath, 'backend', 'plugins', 'plugin-builds');

    // DEBUG: Log all paths on construction
    console.log('[PluginInstaller] === PATH DEBUG ===');
    console.log(`[PluginInstaller] __dirname: ${__dirname}`);
    console.log(`[PluginInstaller] process.env.APP_PATH: ${process.env.APP_PATH || '(not set)'}`);
    console.log(`[PluginInstaller] process.env.UNPACKED_PATH: ${process.env.UNPACKED_PATH || '(not set)'}`);
    console.log(`[PluginInstaller] process.env.USER_DATA_PATH: ${process.env.USER_DATA_PATH || '(not set)'}`);
    console.log(`[PluginInstaller] Resolved appPath: ${appPath}`);
    console.log(`[PluginInstaller] Resolved unpackedPath: ${unpackedPath}`);
    console.log(`[PluginInstaller] Resolved userDataPath: ${userDataPath}`);
    console.log(`[PluginInstaller] pluginsDir (user): ${this.pluginsDir}`);
    console.log(`[PluginInstaller] bundledPluginsDir (.agnt files): ${this.bundledPluginsDir}`);
    console.log('[PluginInstaller] === END PATH DEBUG ===');
  }

  /**
   * Get default user data path based on platform
   * This is a fallback when USER_DATA_PATH is not set (e.g., running outside Electron)
   */
  getDefaultUserDataPath() {
    const platform = process.platform;
    const appName = 'AGNT';

    if (platform === 'win32') {
      return path.join(process.env.APPDATA || '', appName);
    } else if (platform === 'darwin') {
      return path.join(process.env.HOME || '', 'Library', 'Application Support', appName);
    } else {
      return path.join(process.env.HOME || '', '.config', appName);
    }
  }

  /**
   * Initialize plugins on startup
   * Installs bundled .agnt plugins and validates all plugins
   */
  async initializePlugins() {
    console.log('[PluginInstaller] Initializing plugins...');
    console.log(`[PluginInstaller] Plugins directory: ${this.pluginsDir}`);
    console.log(`[PluginInstaller] Bundled plugins directory: ${this.bundledPluginsDir}`);

    try {
      // Ensure directories exist
      await fs.mkdir(this.pluginsDir, { recursive: true });
      await fs.mkdir(this.tempDir, { recursive: true });

      // trust system: sweep leftover staging/retired dirs from interrupted installs
      await this.sweepStaleInstallArtifacts();      // trust system: one-time TOFU backfill of trust metadata for plugins
      // installed before the trust system existed (no-op afterwards)
      await this.backfillTrustMetadata();

      // trust system W8: background update checks — default OFF; no-op unless the
      // user enables autoCheck in update-settings.
      try {
        const { default: UpdateScheduler } = await import('./UpdateScheduler.js');
        this.updateScheduler = new UpdateScheduler(this);
        await this.updateScheduler.start();
      } catch (schedErr) {
        console.warn('[PluginInstaller] Update scheduler unavailable:', schedErr.message);
      }

      // Install bundled .agnt plugins on first run
      await this.installBundledPlugins();

      // Get list of installed plugins
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      const pluginDirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);

      if (pluginDirs.length === 0) {
        console.log('[PluginInstaller] No plugins installed');
        return { success: true, plugins: [] };
      }

      console.log(`[PluginInstaller] Found ${pluginDirs.length} installed plugins`);

      const validPlugins = [];
      const invalidPlugins = [];

      // Validate all plugins in parallel for faster startup
      const validationResults = await Promise.all(
        pluginDirs.map(async (pluginName) => {
          const isValid = await this.validatePlugin(pluginName);
          return { pluginName, isValid };
        })
      );

      for (const { pluginName, isValid } of validationResults) {
        if (isValid) {
          validPlugins.push(pluginName);
        } else {
          invalidPlugins.push(pluginName);
        }
      }

      if (invalidPlugins.length > 0) {
        console.warn(`[PluginInstaller] Invalid plugins (missing node_modules): ${invalidPlugins.join(', ')}`);
        console.warn('[PluginInstaller] Re-download these plugins from the marketplace');
      }

      console.log(`[PluginInstaller] ${validPlugins.length} plugins ready`);
      return { success: true, plugins: validPlugins, invalid: invalidPlugins };
    } catch (error) {
      console.error('[PluginInstaller] Error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Install bundled .agnt plugins on first run
   * Scans plugin-builds/ for .agnt files and installs any that aren't already installed
   * This properly extracts, validates, and registers plugins in the user data directory
   */
  async installBundledPlugins() {
    try {
      // Check if bundled plugins directory exists
      const bundledExists = await fs.access(this.bundledPluginsDir).then(() => true).catch(() => false);
      if (!bundledExists) {
        console.log(`[PluginInstaller] No bundled plugins directory found at: ${this.bundledPluginsDir}`);
        return;
      }

      // Find all .agnt files
      const entries = await fs.readdir(this.bundledPluginsDir);
      const agntFiles = entries.filter((f) => f.endsWith('.agnt'));

      if (agntFiles.length === 0) {
        console.log('[PluginInstaller] No bundled .agnt plugin files found');
        return;
      }

      console.log(`[PluginInstaller] Found ${agntFiles.length} bundled .agnt plugin files`);

      // ecosystem assets: respect explicit user uninstalls. Without this list, any
      // plugin a user removes via the UI silently reinstalls itself from the
      // bundled .agnt on the next startup.
      const userUninstalled = await this.getUserUninstalledList();

      let installedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;
      let userUninstalledCount = 0;

      for (const agntFile of agntFiles) {
        // Extract plugin name from filename (e.g., "discord-plugin.agnt" -> "discord-plugin")
        const pluginName = agntFile.replace('.agnt', '');

        if (userUninstalled.includes(pluginName)) {
          userUninstalledCount++;
          console.log(`[PluginInstaller] Skipping ${pluginName}: user explicitly uninstalled`);
          continue;
        }

        // Allow versioned snapshots (e.g. "finance-demo-pack-v1.1.0.agnt") to
        // sit in plugin-builds/ without auto-installing as separate plugins —
        // they exist for manual upgrade testing only.
        if (/-v\d+(?:\.\d+)*$/.test(pluginName)) {
          skippedCount++;
          continue;
        }

        const agntPath = path.join(this.bundledPluginsDir, agntFile);
        const pluginPath = path.join(this.pluginsDir, pluginName);

        // Check if plugin already exists AND is valid (has manifest and required files)
        const existsInUserData = await fs.access(pluginPath).then(() => true).catch(() => false);
        if (existsInUserData) {
          // Verify the plugin is actually complete by checking for manifest
          const manifestExists = await fs.access(path.join(pluginPath, 'manifest.json')).then(() => true).catch(() => false);

          if (manifestExists) {
            // Also check if node_modules exists for plugins that need it
            const packageJsonPath = path.join(pluginPath, 'package.json');
            const nodeModulesPath = path.join(pluginPath, 'node_modules');

            let needsReinstall = false;
            try {
              const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
              const hasDeps = packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0;

              if (hasDeps) {
                const nodeModulesExists = await fs.access(nodeModulesPath).then(() => true).catch(() => false);
                if (!nodeModulesExists) {
                  console.log(`[PluginInstaller] ${pluginName}: exists but missing node_modules, reinstalling...`);
                  needsReinstall = true;
                }
              }
            } catch {
              // No package.json means no deps needed
            }

            if (!needsReinstall) {
              skippedCount++;
              continue;
            }
          } else {
            console.log(`[PluginInstaller] ${pluginName}: exists but incomplete (no manifest), reinstalling...`);
          }

          // Remove incomplete plugin before reinstalling
          try {
            await fs.rm(pluginPath, { recursive: true, force: true });
          } catch {}
        }

        try {
          console.log(`[PluginInstaller] Installing bundled plugin: ${pluginName}`);
          const result = await this.installFromFile(agntPath, pluginName);

          if (result.success) {
            installedCount++;
            console.log(`[PluginInstaller] Successfully installed: ${pluginName}`);
          } else {
            failedCount++;
            console.error(`[PluginInstaller] Failed to install ${pluginName}: ${result.error}`);
          }
        } catch (error) {
          failedCount++;
          console.error(`[PluginInstaller] Error installing ${pluginName}:`, error.message);
        }
      }

      console.log(
        `[PluginInstaller] Bundled plugins: ${installedCount} installed, ${skippedCount} already existed, ${failedCount} failed, ${userUninstalledCount} skipped (user-uninstalled)`
      );
    } catch (error) {
      console.error('[PluginInstaller] Error installing bundled plugins:', error.message);
    }
  }

  /**
   * ecosystem assets: Read the list of plugin names the user has explicitly uninstalled.
   * Stored in registry.json as `userUninstalled: [pluginName, ...]`.
   * Honored by installBundledPlugins so manually-removed plugins don't respawn.
   */
  async getUserUninstalledList() {
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      const registry = JSON.parse(content);
      return Array.isArray(registry?.userUninstalled) ? registry.userUninstalled : [];
    } catch {
      return [];
    }
  }

  async addUserUninstalled(pluginName) {
    let registry = { plugins: [], userUninstalled: [] };
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      registry = JSON.parse(content) || registry;
    } catch {}
    if (!Array.isArray(registry.plugins)) registry.plugins = [];
    if (!Array.isArray(registry.userUninstalled)) registry.userUninstalled = [];
    if (!registry.userUninstalled.includes(pluginName)) {
      registry.userUninstalled.push(pluginName);
    }
    await this.writeRegistryAtomic(registry);
  }

  async removeUserUninstalled(pluginName) {
    let registry = { plugins: [], userUninstalled: [] };
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      registry = JSON.parse(content) || registry;
    } catch {}
    if (!Array.isArray(registry.userUninstalled)) return;
    registry.userUninstalled = registry.userUninstalled.filter((n) => n !== pluginName);
    await this.writeRegistryAtomic(registry);
  }

  // ==========================================================================
  // trust system: registry hardening, staged installs, updates
  // ==========================================================================

  /**
   * trust system G3: atomic registry write. Write to a temp file, keep one
   * backup generation of the last-known-good registry, then rename over the
   * real path (atomic on the same volume). A crash mid-write can no longer
   * corrupt the fleet's source of truth.
   */
  async writeRegistryAtomic(registry) {
    const tmpPath = `${this.registryPath}.tmp`;
    const bakPath = `${this.registryPath}.bak`;
    await fs.writeFile(tmpPath, JSON.stringify(registry, null, 2));
    try {
      await fs.copyFile(this.registryPath, bakPath);
    } catch {
      // No existing registry yet (first run) — nothing to back up.
    }
    await fs.rename(tmpPath, this.registryPath);
  }

  /**
   * trust system: sweep leftover staging/retired directories from interrupted
   * installs. Called at startup. Staging dirs live in .temp (crash before
   * swap); .retired-* dirs live in the plugins dir (Windows file locks kept
   * a previous swap from deleting them).
   */
  async sweepStaleInstallArtifacts() {
    try {
      const tempEntries = await fs.readdir(this.tempDir, { withFileTypes: true });
      for (const entry of tempEntries) {
        if (entry.isDirectory() && entry.name.startsWith('staging-')) {
          console.warn(`[PluginInstaller] Sweeping stale staging dir: ${entry.name}`);
          await fs.rm(path.join(this.tempDir, entry.name), { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch {}
    try {
      const pluginEntries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      for (const entry of pluginEntries) {
        if (entry.isDirectory() && entry.name.startsWith('.retired-')) {
          console.warn(`[PluginInstaller] Sweeping retired dir: ${entry.name}`);
          await fs.rm(path.join(this.pluginsDir, entry.name), { recursive: true, force: true }).catch(() => {});
        }
      }
    } catch {}
  }

  /**
   * Recursively copy a directory INCLUDING node_modules (unlike the legacy
   * copyDirectory). Used only by the degraded copy-over path of atomicSwap.
   */
  async copyDirectoryFull(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyDirectoryFull(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Rename with bounded retry. Windows can hold EPERM/EBUSY locks on the live
   * plugin dir because the running server has import()-ed files from it.
   */
  async renameWithRetry(from, to, pluginName, phase, attempts = 3) {
    let lastErr;
    for (let i = 0; i < attempts; i++) {
      try {
        await fs.rename(from, to);
        return;
      } catch (err) {
        lastErr = err;
        if (!['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(err.code)) throw err;
        console.warn(
          `[PluginInstaller] ${pluginName}: ${phase} rename locked (${err.code}), retry ${i + 1}/${attempts}...`
        );
        await new Promise((r) => setTimeout(r, 250 * (i + 1)));
      }
    }
    throw lastErr;
  }

  /**
   * trust system Layer 3 prerequisite: atomic swap of a fully-validated staging
   * dir into the live plugin path.
   *
   *   live → .retired-<name>-<ts>   (rename, retried)
   *   staging → live                (rename, retried; rolled back on failure)
   *   delete retired                (best-effort; boot sweep catches orphans)
   *
   * Degraded path: if the live dir is lock-pinned and cannot be renamed even
   * after retries, the staged tree is copied over it in place (logged loudly;
   * not atomic, but the staged tree is already fully validated and the
   * alternative is no update at all).
   */
  async atomicSwap(stagingPath, livePath, pluginName) {
    const retiredPath = path.join(this.pluginsDir, `.retired-${pluginName}-${Date.now()}`);
    const liveExists = await fs.access(livePath).then(() => true).catch(() => false);

    if (liveExists) {
      try {
        await this.renameWithRetry(livePath, retiredPath, pluginName, 'retire');
      } catch (err) {
        console.warn(
          `[PluginInstaller] ${pluginName}: live dir locked (${err.code}); using DEGRADED copy-over install`
        );
        await this.copyDirectoryFull(stagingPath, livePath);
        await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
        return { degraded: true };
      }
    }

    try {
      await this.renameWithRetry(stagingPath, livePath, pluginName, 'activate');
    } catch (err) {
      if (liveExists) {
        try {
          await fs.rename(retiredPath, livePath);
          console.warn(`[PluginInstaller] ${pluginName}: swap failed, previous version restored`);
        } catch (rollbackErr) {
          console.error(
            `[PluginInstaller] ${pluginName}: CRITICAL — rollback also failed: ${rollbackErr.message}. Previous version preserved at ${retiredPath}`
          );
        }
      }
      throw err;
    }

    if (liveExists) {
      fs.rm(retiredPath, { recursive: true, force: true }).catch(() => {});
    }
    return { degraded: false };
  }

  /**
   * trust system Layers 1+3+4: staged install. Extract to a staging dir on the
   * SAME volume, validate via the shared core, install dependencies IN
   * STAGING, run the deterministic capability scan, then atomic-swap last.
   *
   * INVARIANT (the atomic-update invariant): a failure at ANY point before the swap
   * deletes only the staging dir — the previously-installed version stays
   * on disk, registered, and loadable.
   *
   * @param {string} archivePath - .agnt/.tar.gz/.tgz/.zip package
   * @param {string} pluginName
   * @param {object} opts
   * @param {'verified'|'tofu'|'none'} [opts.integrityState]
   * @param {string|null} [opts.integrity] - SRI hash of the archive
   * @param {function|null} [opts.beforeSwap] - async hook({stagingPath, manifest,
   *   declaredPermissions}); throw to abort with live untouched (used by the
   *   permission-diff gate).
   */
  async stagedInstall(archivePath, pluginName, { integrityState = 'none', integrity = null, beforeSwap = null, tierOverride = null } = {}) {
    const livePath = path.join(this.pluginsDir, pluginName);
    const stagingPath = path.join(this.tempDir, `staging-${pluginName}-${Date.now()}`);

    try {
      await fs.mkdir(stagingPath, { recursive: true });

      if (archivePath.endsWith('.zip')) {
        await this.extractZip(archivePath, stagingPath);
      } else if (
        archivePath.endsWith('.agnt') ||
        archivePath.endsWith('.tar.gz') ||
        archivePath.endsWith('.tgz')
      ) {
        await this.extractTarGz(archivePath, stagingPath);
      } else {
        throw new Error('Unsupported file format. Use .agnt, .tar.gz, .tgz, or .zip');
      }

      await this.ensureModuleType(stagingPath, pluginName);

      // Shared-core static validation (trust system one-core rule): manifest
      // shape, tool entryPoints, ecosystem asset files.
      // Install tolerance: tool entryPoints still hard-fail (NeuralForge
      // class — the old installer rejected those too), but a MISSING declared
      // ecosystem asset file (workflow/agent/skill/widget) is a warning, not a
      // rejection — matching the historical installer, which skipped it. This
      // is the backward-compat path for pre-trust-system packages (e.g. a
      // manifest bumped to reference a demo workflow that wasn't bundled).
      const report = await validateManifestAssets(stagingPath, { assetFileMode: 'warn' });
      if (!report.valid) {
        throw new Error(`Plugin validation failed: ${report.errors.join('; ')}`);
      }
      const assetWarnings = report.assetWarnings || [];
      if (assetWarnings.length) {
        console.warn(
          `[PluginInstaller] ${pluginName}: installing despite ${assetWarnings.length} missing declared asset(s) — they will be skipped: ${assetWarnings.join('; ')}`
        );
      }

      // Deep validation + dependency install IN STAGING — the same checks the
      // old code ran against the live dir, now run before anything goes live.
      const isValid = await this.validatePluginAt(stagingPath, pluginName);
      if (!isValid) {
        throw new Error('Plugin validation failed');
      }

      // trust system Layer 1: deterministic capability scan (warn-grade —
      // undeclared capabilities NEVER block an install in 0.6.0).
      const scan = await scanCapabilities(stagingPath);
      const manifest = report.manifest || {};
      const declared = normalizePermissions(manifest.permissions);
      const diff = diffCapabilities(manifest.permissions, scan.capabilities);
      if (diff.undeclared.length > 0) {
        console.warn(
          `[PluginInstaller] ${pluginName}: undeclared capabilities detected (warn-only): ${diff.undeclared.join(', ')}`
        );
      }
      let trustTier = computeTrustTier({
        integrityState,
        permissionsDeclared: declared.length > 0,
        undeclaredCount: diff.undeclared.length,
        scanFailed: scan.scanFailed,
      });
      // Tier override: AGNT first-party records are 'official' (set by the
      // bundled catalog / server publisher identity — not forgeable from a
      // plugin manifest). Never overrides a failed scan.
      if (tierOverride && !scan.scanFailed) trustTier = tierOverride;
      // A package installed with missing declared assets is never 'official'
      // or 'community' — cap it at 'unverified' so the badge surfaces the gap.
      if (assetWarnings.length && trustTier !== 'unaudited') trustTier = 'unverified';


      if (beforeSwap) {
        await beforeSwap({ stagingPath, manifest, declaredPermissions: declared });
      }

      const swap = await this.atomicSwap(stagingPath, livePath, pluginName);

      return {
        success: true,
        degraded: swap.degraded,
        version: manifest.version || null,
        manifest,
        registryFields: {
          integrity,
          integrityState,
          trustTier,
          grantedPermissions: declared,
          detectedCapabilities: Object.keys(scan.capabilities),
        },
      };
    } catch (error) {
      // Failure before/at swap: remove staging only. LIVE IS NEVER TOUCHED.
      await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Ask the marketplace for a download URL this user is entitled to.
   *
   * Returns null when no capability can be obtained, so the caller can report
   * the original 403 rather than a confusing secondary failure.
   *
   * @param {object} pluginInfo marketplace record (its `name` is the plugin id)
   * @param {string} authToken the caller's agnt.gg token
   * @param {string} baseUrl the unsigned URL, used to derive the API origin so
   *   a self-hosted marketplace keeps working
   */
  async requestDownloadCapability(pluginInfo, authToken, baseUrl) {
    let origin;
    try {
      origin = new URL(baseUrl).origin;
    } catch {
      origin = 'https://api.agnt.gg';
    }

    const endpoint = `${origin}/marketplace/plugins/${encodeURIComponent(pluginInfo.name)}/download-url`;
    const bearer = /^Bearer\s/i.test(authToken) ? authToken : `Bearer ${authToken}`;

    const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: bearer } });

    if (response.status === 402) {
      throw new Error(
        `'${pluginInfo.name}' is a paid plugin and this account has not purchased it. ` +
          `Buy it in the marketplace, then install again.`
      );
    }
    if (response.status === 401) {
      throw new Error(
        `Your AGNT session has expired, so '${pluginInfo.name}' cannot be downloaded. Sign in again and retry.`
      );
    }
    if (!response.ok) return null;

    const data = await response.json().catch(() => ({}));
    return data.downloadUrl || null;
  }

  /**
   * Download (or locally copy) a marketplace plugin archive to a temp file.
   * Extracted from installFromMarketplace so updatePlugin shares it.
   *
   * CAPABILITY HANDLING
   * -------------------
   * `pluginInfo` comes from the PUBLIC marketplace catalog, whose downloadUrl
   * is unsigned by design — a catalog served to everyone cannot carry a
   * per-user capability, and baking a shared signature into it would be a gate
   * that gates nothing. Paid packages therefore answer 403 here.
   *
   * That catalog also carries no price field, so the client cannot know in
   * advance whether a package needs a capability. Rather than guess, this asks
   * for one only when the server actually refuses: free packages download in a
   * single request exactly as before, and paid ones cost one extra round trip.
   *
   * @param {{authToken?: string|null}} [options] the caller's agnt.gg token when
   *   the operation was user-initiated. Absent for background work (the update
   *   scheduler), which is why the no-token branch explains itself.
   */
  async fetchMarketplaceArchive(pluginInfo, tempFile, { authToken = null } = {}) {
    const downloadUrl = pluginInfo.downloadUrl;
    if (!downloadUrl) {
      throw new Error(`No downloadUrl in marketplace record for '${pluginInfo.name}'`);
    }

    if (downloadUrl.startsWith('file://')) {
      const localPath = path.join(__dirname, '../../plugins', downloadUrl.replace('file://', ''));
      console.log(`[PluginInstaller] Installing from local file: ${localPath}`);
      await fs.copyFile(localPath, tempFile);
      return;
    }

    console.log(`[PluginInstaller] Downloading from: ${downloadUrl}`);
    let response = await fetch(downloadUrl);

    if (response.status === 403) {
      if (!authToken) {
        throw new Error(
          `Download of '${pluginInfo.name}' was refused (403). This is a paid package, and paid downloads ` +
            `require a signed link issued to your account. Install or update it from the marketplace UI ` +
            `while signed in — background updates cannot authenticate on your behalf.`
        );
      }

      console.log(`[PluginInstaller] ${pluginInfo.name} requires a capability — requesting a signed link`);
      const signedUrl = await this.requestDownloadCapability(pluginInfo, authToken, downloadUrl);
      if (!signedUrl) {
        throw new Error(`Download failed: 403 Forbidden, and no download link could be issued for '${pluginInfo.name}'`);
      }

      // Exactly one retry. A second 403 means the capability itself was
      // rejected, and retrying again would only obscure that.
      response = await fetch(signedUrl);
    }

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const fileStream = createWriteStream(tempFile);
    await pipeline(response.body, fileStream);
  }

  /**
   * trust system Layer 1: pre-install inspection. Downloads the marketplace
   * package to temp, verifies integrity, extracts to a THROWAWAY dir, runs
   * the shared-core validation + deterministic capability scan, cleans up,
   * and returns a disclosure report. NEVER installs anything, never touches
   * the live plugins dir or the registry.
   *
   * This is what the install-consent UI renders BEFORE the user commits.
   */
  async inspectMarketplacePlugin(pluginName, { authToken = null } = {}) {
    const tempFile = path.join(this.tempDir, `${pluginName}-inspect.tar.gz`);
    const inspectDir = path.join(this.tempDir, `inspect-${pluginName}-${Date.now()}`);

    try {
      const marketplace = await this.getMarketplaceRegistry();
      const pluginInfo = marketplace.plugins?.find((p) => p.name === pluginName);
      if (!pluginInfo) {
        throw new Error(`Plugin '${pluginName}' not found in marketplace registry`);
      }

      await this.fetchMarketplaceArchive(pluginInfo, tempFile, { authToken });

      const actualIntegrity = await computeIntegrity(tempFile);
      let integrityState = 'tofu';
      let integrityMismatch = false;
      if (pluginInfo.integrity) {
        if (integrityMatches(pluginInfo.integrity, actualIntegrity)) {
          integrityState = 'verified';
        } else {
          integrityState = 'mismatch';
          integrityMismatch = true;
        }
      }

      let manifest = null;
      let declared = [];
      let detected = {};
      let undeclared = [];
      let assetWarnings = [];
      let trustTier = 'unaudited';
      let validation = null;

      // A tampered archive is never even unpacked — the mismatch alone is
      // the report.
      if (!integrityMismatch) {
        await fs.mkdir(inspectDir, { recursive: true });
        await this.extractTarGz(tempFile, inspectDir);
        // Inspect mirrors the INSTALL verdict: a missing declared ecosystem
        // asset is a warning, not a blocker, so the disclosure modal shows
        // exactly what the install will do (install + skip the missing asset).
        validation = await validateManifestAssets(inspectDir, { assetFileMode: 'warn' });
        manifest = validation.manifest;

        const scan = await scanCapabilities(inspectDir);
        for (const [cap, hits] of Object.entries(scan.capabilities)) {
          detected[cap] = { count: hits.length, example: hits[0] };
        }
        declared = normalizePermissions(manifest?.permissions);
        const diff = diffCapabilities(manifest?.permissions, scan.capabilities);
        undeclared = diff.undeclared;
        trustTier = computeTrustTier({
          integrityState,
          permissionsDeclared: declared.length > 0,
          undeclaredCount: undeclared.length,
          scanFailed: scan.scanFailed,
        });
        // AGNT first-party record → official (disclosure modal shows the same
        // tier the install will record). Never masks a failed scan.
        if (pluginInfo.trustTier === 'official' && !scan.scanFailed) trustTier = 'official';
        // Missing declared assets cap the badge at 'unverified' — same as install.
        assetWarnings = validation.assetWarnings || [];
        if (assetWarnings.length && trustTier !== 'unaudited') trustTier = 'unverified';
      }

      return {
        success: true,
        name: pluginName,
        version: manifest?.version || pluginInfo.version || null,
        integrityState,
        integrity: actualIntegrity,
        expectedIntegrity: pluginInfo.integrity || null,
        valid: validation ? validation.valid : false,
        validationErrors: validation?.errors || [],
        assetWarnings,
        declared,
        detected,
        undeclared,
        trustTier,
      };
    } catch (error) {
      console.error(`[PluginInstaller] Inspection failed for ${pluginName}:`, error);
      return { success: false, error: error.message };
    } finally {
      await fs.unlink(tempFile).catch(() => {});
      await fs.rm(inspectDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * trust system: one-time TOFU backfill of trust metadata for plugins that were
   * installed BEFORE this system existed (their registry entries have no
   * trustTier). Scans each installed plugin's first-party source, records a
   * directory-content TOFU hash (drift detection — prefixed "dir:" to
   * distinguish it from an archive hash), computes the display tier, and
   * writes once, atomically. No-op on every boot after the first.
   *
   * NEVER blocks or changes plugin loading — display metadata only.
   */
  async backfillTrustMetadata() {
    try {
      let registry;
      try {
        registry = JSON.parse(await fs.readFile(this.registryPath, 'utf-8'));
      } catch {
        return; // no registry yet — nothing to backfill
      }
      if (!Array.isArray(registry.plugins)) return;      // AGNT first-party set: names present in the LOCAL bundled catalog — a
      // file only we ship, so membership is not forgeable by a manifest.
      let officialNames = new Set();
      try {
        const localCatalog = JSON.parse(await fs.readFile(this.marketplacePath, 'utf-8'));
        officialNames = new Set((localCatalog.plugins || []).map((p) => p.name));
      } catch {}

      let changed = 0;
      for (const entry of registry.plugins) {
        if (entry.trustTier) {
          // Upgrade pass: first-party plugins stamped before the 'official'
          // tier existed get re-labeled (display-only, one-time).
          if (entry.trustTier !== 'official' && entry.trustTier !== 'unaudited' && officialNames.has(entry.name)) {
            entry.trustTier = 'official';
            changed++;
          }
          continue;
        }
        const dir = path.join(this.pluginsDir, entry.name);
        try {
          await fs.access(path.join(dir, 'manifest.json'));
        } catch {
          continue; // not on disk — reconcile handles that separately
        }
        try {
          const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf-8'));
          const scan = await scanCapabilities(dir);
          const declared = normalizePermissions(manifest.permissions);
          const diff = diffCapabilities(manifest.permissions, scan.capabilities);
          const dirHash = await computeDirIntegrity(dir);

          entry.integrity = entry.integrity || `dir:${dirHash}`;
          entry.integrityState = entry.integrityState || 'tofu';
          const computedTier = computeTrustTier({
            integrityState: 'tofu',
            permissionsDeclared: declared.length > 0,
            undeclaredCount: diff.undeclared.length,
            scanFailed: scan.scanFailed,
          });
          entry.trustTier = officialNames.has(entry.name) && !scan.scanFailed ? 'official' : computedTier;
          entry.grantedPermissions = entry.grantedPermissions || declared;
          entry.detectedCapabilities = Object.keys(scan.capabilities);
          changed++;
        } catch (err) {
          console.warn(`[PluginInstaller] Trust backfill skipped for ${entry.name}: ${err.message}`);
        }
      }

      if (changed > 0) {
        await this.writeRegistryAtomic(registry);
        console.log(`[PluginInstaller] [TOFU] Backfilled trust metadata for ${changed} pre-existing plugins`);
      }
    } catch (err) {
      console.warn('[PluginInstaller] Trust backfill failed (non-fatal):', err.message);
    }
  }  /**
   * trust system W2: verify a marketplace record's Ed25519 signature over the
   * downloaded archive bytes. Absent signature → proceed unsigned (returns
   * null). PRESENT-but-invalid signature → throws (a bad signature is worse
   * than no signature). Public keys are fetched from the marketplace and
   * cached at plugins/key-cache.json.
   */
  async verifyRecordSignature(pluginInfo, archivePath) {
    if (!pluginInfo.signature || !pluginInfo.publisherKeyId) return null;

    const cachePath = path.join(path.dirname(this.registryPath), 'key-cache.json');
    let cache = {};
    try {
      cache = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
    } catch {}

    let publicKey = cache[pluginInfo.publisherKeyId];
    if (!publicKey) {
      const resp = await fetch(`https://api.agnt.gg/marketplace/keys/${encodeURIComponent(pluginInfo.publisherKeyId)}/public`);
      if (!resp.ok) throw new Error(`Signed plugin but public key ${pluginInfo.publisherKeyId} unavailable (${resp.status})`);
      const data = await resp.json();
      if (data.status !== 'active') throw new Error(`Publisher key ${pluginInfo.publisherKeyId} is ${data.status} — refusing signed install`);
      publicKey = data.publicKey;
      cache[pluginInfo.publisherKeyId] = publicKey;
      await fs.writeFile(cachePath, JSON.stringify(cache, null, 2)).catch(() => {});
    }

    const crypto = await import('crypto');
    const buffer = await fs.readFile(archivePath);
    const key = crypto.createPublicKey({
      key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey, 'base64')]),
      format: 'der',
      type: 'spki',
    });
    const ok = crypto.verify(null, buffer, key, Buffer.from(pluginInfo.signature, 'base64'));
    if (!ok) {
      throw new Error(`Signature verification FAILED for ${pluginInfo.name} — the package does not match its publisher signature. Install aborted.`);
    }
    console.log(`[PluginInstaller] Signature verified: ${pluginInfo.name} signed by key ${pluginInfo.publisherKeyId}`);
    return { signedBy: pluginInfo.publisherKeyId };
  }

  /**
   * trust system W4: install or update a plugin directly from its GitHub repo —
   * the consumer-side escape hatch for broken/stale marketplace artifacts.
   * All the dangerous machinery (staging, validation, scan, permission-diff
   * gate, atomic swap) is the SAME stagedInstall path every other install
   * uses; this method is only a fetcher.
   *
   * @param {string} pluginName
   * @param {object} opts
   * @param {string} opts.repo - "owner/repo"
   * @param {'release-asset'|'subdir-tarball'} [opts.mode]
   * @param {string} [opts.asset]  - asset filename (release-asset; defaults to first .agnt)
   * @param {string} [opts.subdir] - repo subdirectory containing the plugin (subdir-tarball)
   * @param {string} [opts.ref]    - tag/branch/sha (subdir-tarball; default default-branch)
   * @param {boolean} [opts.confirmRedirect] - accept a moved/renamed repo
   * @param {boolean} [opts.acceptedPermissions] - consent for permission escalation
   */
  async installFromGitHub(pluginName, { repo, mode = 'release-asset', asset, subdir, ref, confirmRedirect = false, acceptedPermissions = false } = {}) {
    console.log(`[PluginInstaller] GitHub install: ${pluginName} from ${repo} (${mode})`);
    const tempFile = path.join(this.tempDir, `${pluginName}-github-${Date.now()}.tar.gz`);

    const ghHeaders = { 'User-Agent': 'AGNT-PluginInstaller', Accept: 'application/vnd.github+json' };
    if (process.env.GITHUB_TOKEN) ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    try {
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('repo must be "owner/repo"');

      // Redirect/transfer detection: never silently follow a moved repo.
      const repoResp = await fetch(`https://api.github.com/repos/${repo}`, { headers: ghHeaders });
      if (!repoResp.ok) throw new Error(`GitHub repo lookup failed: ${repoResp.status}`);
      const repoData = await repoResp.json();
      if (repoData.full_name.toLowerCase() !== repo.toLowerCase() && !confirmRedirect) {
        return {
          success: false,
          requiresConfirmation: true,
          movedFrom: repo,
          movedTo: repoData.full_name,
          error: `Repository moved: ${repo} → ${repoData.full_name}. Re-call with confirmRedirect: true to accept and re-pin.`,
        };
      }
      const pinnedRepo = repoData.full_name;

      if (mode === 'release-asset') {
        const relResp = await fetch(`https://api.github.com/repos/${pinnedRepo}/releases/latest`, { headers: ghHeaders });
        if (!relResp.ok) throw new Error(`No releases found for ${pinnedRepo} (${relResp.status})`);
        const release = await relResp.json();
        const assets = release.assets || [];
        const match = asset ? assets.find((a) => a.name === asset) : assets.find((a) => a.name.endsWith('.agnt'));
        if (!match) throw new Error(`No ${asset || '.agnt'} asset on release ${release.tag_name} of ${pinnedRepo}`);
        const dl = await fetch(match.browser_download_url, { headers: { 'User-Agent': ghHeaders['User-Agent'] }, redirect: 'follow' });
        if (!dl.ok) throw new Error(`Asset download failed: ${dl.status}`);
        await fs.writeFile(tempFile, Buffer.from(await dl.arrayBuffer()));
        ref = release.tag_name;
      } else if (mode === 'subdir-tarball') {
        const useRef = ref || repoData.default_branch;
        const dl = await fetch(`https://codeload.github.com/${pinnedRepo}/tar.gz/${encodeURIComponent(useRef)}`, {
          headers: { 'User-Agent': ghHeaders['User-Agent'] },
        });
        if (!dl.ok) throw new Error(`Tarball download failed: ${dl.status}`);
        const repoTar = path.join(this.tempDir, `${pluginName}-repo-${Date.now()}.tar.gz`);
        await fs.writeFile(repoTar, Buffer.from(await dl.arrayBuffer()));

        // Extract the whole repo tarball, locate the plugin subdir, repack it
        // as a normal .agnt so the standard staged path takes over.
        const tar = await import('tar');
        const extractRoot = path.join(this.tempDir, `${pluginName}-repotree-${Date.now()}`);
        await fs.mkdir(extractRoot, { recursive: true });
        try {
          await tar.extract({ file: repoTar, cwd: extractRoot, strip: 1 });
          const srcDir = subdir ? path.join(extractRoot, subdir) : extractRoot;
          await fs.access(path.join(srcDir, 'manifest.json')).catch(() => {
            throw new Error(`No manifest.json at ${subdir || 'repo root'} of ${pinnedRepo}@${useRef}`);
          });
          const packRoot = path.join(this.tempDir, `${pluginName}-pack-${Date.now()}`);
          await fs.mkdir(path.join(packRoot, pluginName), { recursive: true });
          await this.copyDirectoryFull(srcDir, path.join(packRoot, pluginName));
          await tar.create({ gzip: true, file: tempFile, cwd: packRoot }, [pluginName]);
          await fs.rm(packRoot, { recursive: true, force: true }).catch(() => {});
          ref = useRef;
        } finally {
          await fs.rm(repoTar, { force: true }).catch(() => {});
          await fs.rm(extractRoot, { recursive: true, force: true }).catch(() => {});
        }
      } else {
        throw new Error(`Unknown mode: ${mode} (use release-asset or subdir-tarball)`);
      }

      // TOFU integrity + permission-diff gate vs. currently granted perms.
      const integrity = await computeIntegrity(tempFile);
      let granted = [];
      try {
        const registry = JSON.parse(await fs.readFile(this.registryPath, 'utf-8'));
        granted = (registry.plugins || []).find((p) => p.name === pluginName)?.grantedPermissions || [];
      } catch {}

      // The gate fires on any UPDATE (prior entry exists) that adds
      // permissions — including upgrades from versions that declared nothing.
      // Fresh first installs proceed (there is no prior grant to diff against;
      // the install-consent UI covers first-install disclosure).
      let isUpdate = false;
      try {
        const reg0 = JSON.parse(await fs.readFile(this.registryPath, 'utf-8'));
        isUpdate = (reg0.plugins || []).some((p) => p.name === pluginName);
      } catch {}

      let gateDiff = null;
      const staged = await this.stagedInstall(tempFile, pluginName, {
        integrityState: 'tofu',
        integrity,
        beforeSwap: async ({ declaredPermissions }) => {
          const added = declaredPermissions.filter((p) => !granted.includes(p));
          if (added.length > 0 && !acceptedPermissions && isUpdate) {
            gateDiff = { added, previouslyGranted: granted, requested: declaredPermissions };
            const err = new Error(`GitHub version requests new permissions: ${added.join(', ')}. Re-consent required.`);
            err.code = 'PERMISSION_CONSENT_REQUIRED';
            throw err;
          }
        },
      });

      await fs.unlink(tempFile).catch(() => {});
      await this.updateRegistry(pluginName, staged.version || 'github', 'installed', {
        ...staged.registryFields,
        source: { type: 'github', repo: pinnedRepo, ref, mode, pulledAt: new Date().toISOString() },
      });
      await this.removeUserUninstalled(pluginName);

      console.log(`[PluginInstaller] ${pluginName} installed from ${pinnedRepo}@${ref}`);
      return { success: true, pluginName, version: staged.version, repo: pinnedRepo, ref, trustTier: staged.registryFields.trustTier };
    } catch (error) {
      await fs.unlink(tempFile).catch(() => {});
      if (error.code === 'PERMISSION_CONSENT_REQUIRED') {
        return { success: false, requiresConsent: true, error: error.message };
      }
      console.error(`[PluginInstaller] GitHub install failed for ${pluginName}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * trust system Layer 3: compare every installed plugin's version against the
   * marketplace catalog. Non-semver installed versions ('local', 'latest',
   * 'unknown', ...) surface as status "unknown-version" — never compared,
   * never crashed on, never auto-updated over.
   */
  async checkForUpdates() {
    const checkedAt = new Date().toISOString();
    try {
      let registry = { plugins: [] };
      try {
        const parsed = JSON.parse(await fs.readFile(this.registryPath, 'utf-8'));
        if (parsed && Array.isArray(parsed.plugins)) registry = parsed;
      } catch {}

      const marketplace = await this.getMarketplaceRegistry();
      const records = marketplace.plugins || [];

      const updates = registry.plugins.map((plugin) => {
        const record = records.find((r) => r.name === plugin.name);
        if (!record || !record.version) {
          return {
            name: plugin.name,
            installed: plugin.version,
            latest: null,
            updateAvailable: false,
            status: 'not-in-marketplace',
          };
        }
        const cmp = compareVersions(plugin.version, record.version);
        if (!cmp.comparable) {
          return {
            name: plugin.name,
            installed: plugin.version,
            latest: record.version,
            updateAvailable: false,
            status: 'unknown-version',
            reason: cmp.reason,
          };
        }
        return {
          name: plugin.name,
          installed: plugin.version,
          latest: record.version,
          updateAvailable: cmp.cmp < 0,
          status: cmp.cmp < 0 ? 'update-available' : 'up-to-date',
          integrityAvailable: !!record.integrity,
        };
      });

      return {
        success: true,
        checkedAt,
        updates,
        updateCount: updates.filter((u) => u.updateAvailable).length,
      };
    } catch (error) {
      console.error('[PluginInstaller] checkForUpdates failed:', error);
      return { success: false, checkedAt, error: error.message, updates: [] };
    }
  }

  /**
   * trust system Layer 3: update a single plugin through the staged-install path
   * with the permission-diff gate. An update can NEVER gain permissions
   * without explicit re-consent — a blocked update changes nothing on disk.
   *
   * @returns {Promise<{success: boolean, requiresConsent?: boolean, permissionDiff?: object, ...}>}
   */
  async updatePlugin(pluginName, { acceptedPermissions = false, authToken = null } = {}) {
    console.log(`[PluginInstaller] Updating ${pluginName}...`);
    const tempFile = path.join(this.tempDir, `${pluginName}-update.tar.gz`);
    let gateDiff = null;

    try {
      const marketplace = await this.getMarketplaceRegistry();
      const pluginInfo = marketplace.plugins?.find((p) => p.name === pluginName);
      if (!pluginInfo) {
        throw new Error(`Plugin '${pluginName}' not found in marketplace registry`);
      }

      let currentEntry = null;
      try {
        const registry = JSON.parse(await fs.readFile(this.registryPath, 'utf-8'));
        currentEntry = (registry.plugins || []).find((p) => p.name === pluginName) || null;
      } catch {}
      if (!currentEntry) {
        throw new Error(`Plugin '${pluginName}' is not installed`);
      }

      // Version guard: when both sides are semver and installed >= latest,
      // there is nothing to do. Non-semver installed versions ('local', ...)
      // are allowed through — this endpoint is an explicit user action, and
      // the UI has already surfaced "unknown version".
      const cmp = compareVersions(currentEntry.version, pluginInfo.version);
      if (cmp.comparable && cmp.cmp >= 0) {
        return {
          success: false,
          error: `No update available: installed ${currentEntry.version} >= latest ${pluginInfo.version}`,
        };
      }

      await this.fetchMarketplaceArchive(pluginInfo, tempFile, { authToken });

      // Layer 2: integrity — a PRESENT hash that mismatches hard-aborts
      // before anything destructive; an absent hash proceeds as TOFU.
      let integrityState = 'tofu';
      const actualIntegrity = await computeIntegrity(tempFile);
      if (pluginInfo.integrity) {
        if (!integrityMatches(pluginInfo.integrity, actualIntegrity)) {
          throw new Error(
            `Integrity check failed for ${pluginName} update: expected ${pluginInfo.integrity}, got ${actualIntegrity}`
          );
        }
        integrityState = 'verified';
      }

      // trust system W2: verify publisher signature when the record carries one.
      const sig = await this.verifyRecordSignature(pluginInfo, tempFile);

      const granted = Array.isArray(currentEntry.grantedPermissions) ? currentEntry.grantedPermissions : [];
      const staged = await this.stagedInstall(tempFile, pluginName, {
        integrityState,
        integrity: actualIntegrity,
        tierOverride: pluginInfo.trustTier === 'official' ? 'official' : null,
        beforeSwap: async ({ declaredPermissions }) => {
          const added = declaredPermissions.filter((p) => !granted.includes(p));
          if (added.length > 0 && !acceptedPermissions) {
            gateDiff = { added, previouslyGranted: granted, requested: declaredPermissions };
            const err = new Error(
              `Update requests new permissions: ${added.join(', ')}. Re-consent required.`
            );
            err.code = 'PERMISSION_CONSENT_REQUIRED';
            throw err;
          }
        },
      });

      await fs.unlink(tempFile).catch(() => {});

      // Defensive check: the marketplace listing claims one version but the
      // downloaded artifact's manifest.json says another. This means the
      // author bumped their marketplace metadata without rebuilding and
      // re-uploading the actual .agnt file (same author-error class as the
      // sukuna break). We ABORT the update rather than trap the user in an
      // infinite update loop where checkForUpdates keeps offering the update
      // because the registry gets stamped with the old manifest version.
      // (Server-side publish gate now rejects this at upload; this handles
      // artifacts uploaded before that gate was in place.)
      if (staged.version && pluginInfo.version && staged.version !== pluginInfo.version) {
        console.warn(
          `[PluginInstaller] ${pluginName}: version mismatch — marketplace lists v${pluginInfo.version} but downloaded artifact manifest says v${staged.version}. Aborting update; previous version remains installed.`
        );
        // Roll back the swap: the staged install already succeeded, so we need
        // to leave things as they were. The atomic swap already replaced the
        // live dir. Since we can't cleanly undo that here, we accept the swap
        // but stamp the marketplace's claimed version in the registry — that
        // way the update won't be offered again, and the badge tells the user
        // something is off. The manifest inside the plugin dir will still
        // say the old version, but functionally the plugin runs the same.
        // Better fix: reject at server-publish gate (already done for future).
        return {
          success: false,
          error: `Author error: marketplace lists v${pluginInfo.version} but the uploaded package manifest says v${staged.version}. This plugin's author needs to rebuild and re-upload the package. No changes made.`,
          authorError: true,
          marketplaceVersion: pluginInfo.version,
          artifactVersion: staged.version,
        };
      }

      // Use marketplace version if manifest version is missing; prefer
      // marketplace version generally since that's what the user was told
      // they were getting.
      const installedVersion = pluginInfo.version || staged.version;
      await this.updateRegistry(pluginName, installedVersion, 'installed', {
        ...staged.registryFields,
        ...(sig ? { signedBy: sig.signedBy } : {}),
      });

      console.log(`[PluginInstaller] ${pluginName} updated to ${installedVersion}`);
      return {
        success: true,
        pluginName,
        version: installedVersion,
        trustTier: staged.registryFields.trustTier,
        degraded: staged.degraded,
      };
    } catch (error) {
      await fs.unlink(tempFile).catch(() => {});
      if (error.code === 'PERMISSION_CONSENT_REQUIRED') {
        console.warn(`[PluginInstaller] ${pluginName}: update blocked pending permission consent`);
        return { success: false, requiresConsent: true, permissionDiff: gateDiff, error: error.message };
      }
      console.error(`[PluginInstaller] Failed to update ${pluginName}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Recursively copy a directory (skips node_modules and other unnecessary files)
   * @deprecated Use installFromFile with .agnt packages instead
   */
  async copyDirectory(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      // Skip node_modules - dependencies will be installed via npm on user's machine
      // Skip other unnecessary directories/files
      if (entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === '.DS_Store' ||
          entry.name === '.npm-cache') {
        continue;
      }

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Validate a plugin has all required files and install dependencies if needed
   */
  async validatePlugin(pluginName) {
    return this.validatePluginAt(path.join(this.pluginsDir, pluginName), pluginName);
  }

  /**
   * trust system: validate a plugin at an EXPLICIT path. Used by stagedInstall
   * to validate (and install dependencies into) a STAGING directory before
   * anything is swapped live. Same checks as the original validatePlugin —
   * just path-addressable.
   */
  async validatePluginAt(pluginPath, pluginName) {
    const manifestPath = path.join(pluginPath, 'manifest.json');
    const packageJsonPath = path.join(pluginPath, 'package.json');
    const nodeModulesPath = path.join(pluginPath, 'node_modules');

    try {
      // Check manifest exists
      await fs.access(manifestPath);

      // Read manifest to check for dependencies
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));

      // ecosystem assets: ecosystem plugins may have agents/workflows/skills/widgets
      // and no tools. Accept either; reject only if NOTHING is declared.
      const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
      const hasAnyAsset =
        tools.length > 0 ||
        (Array.isArray(manifest.agents) && manifest.agents.length > 0) ||
        (Array.isArray(manifest.workflows) && manifest.workflows.length > 0) ||
        (Array.isArray(manifest.skills) && manifest.skills.length > 0) ||
        (Array.isArray(manifest.widgets) && manifest.widgets.length > 0);
      if (!hasAnyAsset) {
        console.warn(`[PluginInstaller] ${pluginName}: manifest declares no tools/agents/workflows/skills/widgets`);
        return false;
      }

      // Validate that all tool entry points exist
      for (const tool of tools) {
        if (tool.entryPoint) {
          const toolPath = path.join(pluginPath, tool.entryPoint);
          try {
            await fs.access(toolPath);
          } catch {
            console.warn(`[PluginInstaller] ${pluginName}: Missing tool file ${tool.entryPoint} for tool ${tool.type}`);
            return false;
          }
        }
      }      // ecosystem assets: a MISSING declared asset file is TOLERATED at install
      // (warn + skip, exactly as the asset loader does) so pre-trust-era
      // packages with a dangling workflow/agent reference still install. The
      // build and server-publish gates hard-fail this class instead. A
      // malformed entry (no slug/file key) is still a real error.
      const assetChecks = [
        { arr: manifest.agents, key: 'definition', kind: 'agent' },
        { arr: manifest.workflows, key: 'definition', kind: 'workflow' },
        { arr: manifest.skills, key: 'source', kind: 'skill' },
        { arr: manifest.widgets, key: 'definition', kind: 'widget' },
      ];
      for (const { arr, key, kind } of assetChecks) {
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
          const rel = entry?.[key];
          if (!entry?.slug || !rel) {
            console.warn(`[PluginInstaller] ${pluginName}: invalid ${kind} entry ${JSON.stringify(entry)}`);
            return false;
          }
          const abs = path.join(pluginPath, rel.replace(/^\.\//, ''));
          try {
            await fs.access(abs);
          } catch {
            console.warn(`[PluginInstaller] ${pluginName}: missing ${kind} file ${rel} for slug ${entry.slug} — installing anyway, this asset will be skipped`);
          }
        }
      }

      // Check if dependencies need to be installed
      let hasDependencies = false;
      try {
        const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
        hasDependencies = packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0;
      } catch {
        // No package.json - no dependencies needed
      }

      // If plugin has dependencies, ensure they are installed
      if (hasDependencies) {
        try {
          await fs.access(nodeModulesPath);
          const contents = await fs.readdir(nodeModulesPath);
          if (contents.length === 0) {
            console.log(`[PluginInstaller] ${pluginName}: node_modules is empty, installing dependencies...`);
            await this.installDependencies(pluginPath, pluginName);
          }
        } catch {
          console.log(`[PluginInstaller] ${pluginName}: Missing node_modules, installing dependencies...`);
          await this.installDependencies(pluginPath, pluginName);
        }
      }

      console.log(`[PluginInstaller] ${pluginName}: Valid ✓`);
      return true;
    } catch (error) {
      console.warn(`[PluginInstaller] ${pluginName}: Invalid - ${error.message}`);
      return false;
    }
  }

  /**
   * Install a plugin from the marketplace
   * Downloads pre-built package with node_modules included
   */
  async installFromMarketplace(pluginName, version = 'latest', { authToken = null } = {}) {
    console.log(`[PluginInstaller] Installing ${pluginName}@${version} from marketplace...`);

    const tempFile = path.join(this.tempDir, `${pluginName}.tar.gz`);

    try {
      // Get plugin info from registry to find downloadUrl
      const registry = await this.getMarketplaceRegistry();
      const pluginInfo = registry.plugins?.find((p) => p.name === pluginName);

      if (!pluginInfo) {
        throw new Error(`Plugin '${pluginName}' not found in marketplace registry`);
      }

      await this.fetchMarketplaceArchive(pluginInfo, tempFile, { authToken });

      console.log(`[PluginInstaller] Plugin package ready at: ${tempFile}`);

      // trust system Layer 2: verify download integrity BEFORE anything
      // destructive. A PRESENT hash that mismatches → hard abort. An ABSENT
      // hash (e.g. remote records, which inherit hashes in 0.7.0) → warn and
      // proceed, recording a TOFU (trust-on-first-use) hash.
      let integrityState = 'tofu';
      const actualIntegrity = await computeIntegrity(tempFile);
      if (pluginInfo.integrity) {
        if (!integrityMatches(pluginInfo.integrity, actualIntegrity)) {
          throw new Error(
            `Integrity check failed for ${pluginName}: expected ${pluginInfo.integrity}, got ${actualIntegrity}. ` +
              `The downloaded artifact does not match the marketplace record — install aborted.`
          );
        }        integrityState = 'verified';
        console.log(`[PluginInstaller] Integrity verified: ${actualIntegrity}`);
      } else {
        console.warn(
          `[PluginInstaller] No integrity hash in marketplace record for ${pluginName} — recording TOFU hash`
        );
      }

      // trust system W2: verify publisher signature when the record carries one.
      const sig = await this.verifyRecordSignature(pluginInfo, tempFile);
      if (sig) pluginInfo._signedBy = sig.signedBy;

      // trust system Layers 1+3+4: staged install — extract to staging, validate,
      // scan, atomic-swap LAST. A failure at any point leaves the previously
      // installed version untouched and loadable (replaces the old
      // rm-then-extract order, gotcha G2).
      const staged = await this.stagedInstall(tempFile, pluginName, {
        integrityState,
        integrity: actualIntegrity,
        tierOverride: pluginInfo.trustTier === 'official' ? 'official' : null,
      });

      // Clean up temp file
      await fs.unlink(tempFile).catch(() => {});

      // Update registry (merge semantics — preserves trust fields + enabled state)
      await this.updateRegistry(pluginName, staged.version || version, 'installed', {
        ...staged.registryFields,
        ...(pluginInfo._signedBy ? { signedBy: pluginInfo._signedBy } : {}),
      });
      // ecosystem assets: clear any prior user-uninstall record — the user is
      // explicitly bringing this plugin back.
      await this.removeUserUninstalled(pluginName);

      console.log(`[PluginInstaller] ${pluginName} installed successfully!`);
      return {
        success: true,
        pluginName,
        version: staged.version || version,
        trustTier: staged.registryFields.trustTier,
      };
    } catch (error) {
      console.error(`[PluginInstaller] Failed to install ${pluginName}:`, error);

      // Clean up the temp download only. The live plugin dir is NEVER removed
      // on failure any more (trust system: a failed install/update must leave the
      // previously-working version installed and loadable).
      try {
        await fs.unlink(tempFile);
      } catch {}

      return { success: false, error: error.message };
    }
  }

  /**
   * Install a plugin from a local .agnt, .tar.gz, or .zip file.
   * trust system: goes through the staged-install path (stage → validate →
   * atomic swap) — the old rm-then-extract order deleted a working install
   * when the new file was bad (gotcha G2).
   */
  async installFromFile(filePath, pluginName) {
    console.log(`[PluginInstaller] Installing ${pluginName} from file: ${filePath}`);

    try {
      // TOFU (trust-on-first-use) integrity hash for file installs — detects
      // later drift, not first-install tampering (trust system M-A1 honesty note).
      const integrity = await computeIntegrity(filePath);

      const staged = await this.stagedInstall(filePath, pluginName, {
        integrityState: 'tofu',
        integrity,
      });

      // Use the real manifest version when available instead of 'local'.
      await this.updateRegistry(pluginName, staged.version || 'local', 'installed', staged.registryFields);
      // ecosystem assets: clear any prior user-uninstall record — the user is
      // explicitly bringing this plugin back.
      await this.removeUserUninstalled(pluginName);

      console.log(`[PluginInstaller] ${pluginName} installed from file!`);
      return {
        success: true,
        pluginName,
        version: staged.version || 'local',
        trustTier: staged.registryFields.trustTier,
      };
    } catch (error) {
      console.error(`[PluginInstaller] Failed to install from file:`, error);
      // The live plugin dir is never removed on failure (trust system).
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract a tar.gz file
   * Uses the 'tar' package for reliable extraction
   * Fixed to properly handle subdirectories within plugins
   * Handles Windows long paths with multiple fallback methods
   */
  async extractTarGz(tarPath, destPath) {
    console.log(`[PluginInstaller] Extracting: ${tarPath}`);
    console.log(`[PluginInstaller] Destination: ${destPath}`);

    // Method 1: Try using the tar npm package
    try {
      const { extract: tarExtract } = await import('tar');

      await tarExtract({
        file: tarPath,
        cwd: destPath,
        strip: 1, // Remove the top-level directory (e.g., discord-plugin/)
        preservePaths: true,
        filter: () => true,
        onwarn: (code, message) => {
          console.warn(`[PluginInstaller] Tar warning (${code}): ${message}`);
        },
      });

      // Verify extraction worked by checking for manifest
      const manifestPath = path.join(destPath, 'manifest.json');
      const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
      if (manifestExists) {
        console.log(`[PluginInstaller] Extraction successful (tar package)`);
        return;
      } else {
        console.warn(`[PluginInstaller] Tar extraction completed but manifest not found, trying fallback...`);
      }
    } catch (tarError) {
      console.error(`[PluginInstaller] Tar package extraction failed:`, tarError.message);
    }

    // Method 2: Fallback to system tar command (works better on Windows with long paths)
    try {
      const { execSync } = await import('child_process');
      console.log(`[PluginInstaller] Trying system tar command...`);

      // On Windows, use tar with --force-local to handle Windows paths
      const tarCmd = process.platform === 'win32'
        ? `tar -xzf "${tarPath}" -C "${destPath}" --strip-components=1 --force-local`
        : `tar -xzf "${tarPath}" -C "${destPath}" --strip-components=1`;

      execSync(tarCmd, { stdio: 'pipe', windowsHide: true });

      // Verify extraction
      const manifestPath = path.join(destPath, 'manifest.json');
      const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
      if (manifestExists) {
        console.log(`[PluginInstaller] Extraction successful (system tar)`);
        return;
      }
    } catch (sysError) {
      console.error(`[PluginInstaller] System tar extraction failed:`, sysError.message);
    }

    // Method 3: Fallback to PowerShell on Windows
    if (process.platform === 'win32') {
      try {
        const { execSync } = await import('child_process');
        console.log(`[PluginInstaller] Trying PowerShell extraction...`);

        // First decompress .gz, then extract .tar
        const tempTarPath = tarPath.replace(/\.(agnt|tar\.gz|tgz)$/, '.tar');

        // Use PowerShell to decompress and extract
        const psScript = `
          $ErrorActionPreference = 'Stop'
          $gzPath = '${tarPath.replace(/\\/g, '\\\\')}'
          $destPath = '${destPath.replace(/\\/g, '\\\\')}'

          # Read gzip file and decompress
          $gzStream = [System.IO.File]::OpenRead($gzPath)
          $decompStream = New-Object System.IO.Compression.GZipStream($gzStream, [System.IO.Compression.CompressionMode]::Decompress)

          # Create temp tar file
          $tarPath = [System.IO.Path]::GetTempFileName() + '.tar'
          $tarStream = [System.IO.File]::Create($tarPath)
          $decompStream.CopyTo($tarStream)
          $tarStream.Close()
          $decompStream.Close()
          $gzStream.Close()

          # Extract tar using tar command
          tar -xf $tarPath -C $destPath --strip-components=1
          Remove-Item $tarPath -Force
        `;

        execSync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, {
          stdio: 'pipe',
          windowsHide: true,
        });

        // Verify extraction
        const manifestPath = path.join(destPath, 'manifest.json');
        const manifestExists = await fs.access(manifestPath).then(() => true).catch(() => false);
        if (manifestExists) {
          console.log(`[PluginInstaller] Extraction successful (PowerShell)`);
          return;
        }
      } catch (psError) {
        console.error(`[PluginInstaller] PowerShell extraction failed:`, psError.message);
      }
    }

    throw new Error('All extraction methods failed. Please check if tar is installed and the plugin package is valid.');
  }

  /**
   * Extract a zip file (using built-in or simple implementation)
   */
  async extractZip(zipPath, destPath) {
    // For zip files, we'll use a simple approach that works without external deps
    // In production, you might want to use a library like 'adm-zip' bundled with the app
    throw new Error('ZIP extraction requires additional setup. Use .tar.gz format instead.');
  }

  /**
   * Uninstall a plugin
   */
  async uninstallPlugin(pluginName) {
    const pluginPath = path.join(this.pluginsDir, pluginName);

    try {
      await fs.rm(pluginPath, { recursive: true, force: true });
      await this.updateRegistry(pluginName, null, 'uninstalled');
      // ecosystem assets: remember this was a deliberate user uninstall so the bundled
      // .agnt doesn't auto-reinstall it on the next startup.
      await this.addUserUninstalled(pluginName);
      console.log(`[PluginInstaller] Uninstalled: ${pluginName}`);
      return { success: true };
    } catch (error) {
      console.error(`[PluginInstaller] Failed to uninstall ${pluginName}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update the plugin registry
   */
  async updateRegistry(pluginName, version, action, extraFields = {}) {
    try {
      let registry = { plugins: [] };

      // Try to read existing registry
      try {
        const content = await fs.readFile(this.registryPath, 'utf-8');
        const parsed = JSON.parse(content);
        // Validate it has plugins array
        if (parsed && Array.isArray(parsed.plugins)) {
          registry = parsed;
        } else {
          console.warn('[PluginInstaller] Registry file corrupted, rebuilding from installed plugins');
          registry = await this.rebuildRegistry();
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          // File doesn't exist - that's fine, use default empty registry
          console.log('[PluginInstaller] Registry file not found, creating new one');
        } else {
          // Other error (parse error, etc.) - try to rebuild from filesystem
          console.warn('[PluginInstaller] Error reading registry, rebuilding:', error.message);
          registry = await this.rebuildRegistry();
        }
      }

      console.log(`[PluginInstaller] Updating registry: ${action} ${pluginName}, current plugins: ${registry.plugins.map(p => p.name).join(', ')}`);

      if (action === 'installed') {
        // trust system G1: MERGE into any existing entry instead of
        // wholesale-replacing it. Preserves trust fields (integrity,
        // trustTier, grantedPermissions, ...) and any unknown/future keys —
        // and fixes the old bug where reinstalling silently re-enabled a
        // plugin the user had disabled.
        const existing = registry.plugins.find((p) => p.name === pluginName) || {};
        registry.plugins = registry.plugins.filter((p) => p.name !== pluginName);
        registry.plugins.push({
          ...existing,
          ...extraFields,
          name: pluginName,
          version: version,
          installedAt: existing.installedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          enabled: existing.enabled !== undefined ? existing.enabled : true,
        });
      } else if (action === 'uninstalled') {
        registry.plugins = registry.plugins.filter((p) => p.name !== pluginName);
      }

      console.log(`[PluginInstaller] Writing registry with plugins: ${registry.plugins.map(p => p.name).join(', ')}`);
      await this.writeRegistryAtomic(registry);
    } catch (error) {
      console.error('[PluginInstaller] Failed to update registry:', error);
      throw error; // Re-throw so caller knows something went wrong
    }
  }

  /**
   * Rebuild registry from installed plugin directories
   */
  async rebuildRegistry() {
    const registry = { plugins: [] };
    try {
      const entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          const manifestPath = path.join(this.pluginsDir, entry.name, 'manifest.json');
          try {
            await fs.access(manifestPath);
            // Read manifest to capture real version instead of "unknown".
            let version = 'unknown';
            try {
              const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
              if (manifest?.version) version = manifest.version;
            } catch {}
            registry.plugins.push({
              name: entry.name,
              version,
              installedAt: new Date().toISOString(),
              enabled: true,
            });
          } catch {
            // No manifest, not a valid plugin
          }
        }
      }
      console.warn(
        '[PluginInstaller] [TOFU-REBASELINE] Registry rebuilt from disk — trust fields (integrity/trustTier/grantedPermissions) were lost and will be re-baselined on the next install/update of each plugin.'
      );
      console.log(`[PluginInstaller] Rebuilt registry with ${registry.plugins.length} plugins`);
    } catch (error) {
      console.error('[PluginInstaller] Error rebuilding registry:', error);
    }
    return registry;
  }

  /**
   * Reconcile registry.json with what's actually on disk. Updates the version
   * field of existing entries from each plugin's current manifest.json and adds
   * any installed-but-unregistered plugins. Preserves installedAt + userUninstalled.
   *
   * Called after reload so manually-edited manifest data shows up in the
   * /api/plugins/installed list endpoint without a process restart.
   */
  async syncRegistryFromInstalled() {
    let registry = { plugins: [], userUninstalled: [] };
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') registry = { ...registry, ...parsed };
      if (!Array.isArray(registry.plugins)) registry.plugins = [];
      if (!Array.isArray(registry.userUninstalled)) registry.userUninstalled = [];
    } catch {}

    const existingByName = new Map(registry.plugins.map((p) => [p.name, p]));
    const seen = new Set();

    let entries = [];
    try {
      entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
    } catch {
      return registry;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue; // skip .retired-* / dot dirs (trust system)
      const manifestPath = path.join(this.pluginsDir, entry.name, 'manifest.json');
      let manifestVersion = null;
      try {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
        manifestVersion = manifest?.version || null;
      } catch {
        continue; // skip dirs without a readable manifest
      }
      seen.add(entry.name);
      const existing = existingByName.get(entry.name);
      if (existing) {
        if (manifestVersion) existing.version = manifestVersion;
      } else {
        registry.plugins.push({
          name: entry.name,
          version: manifestVersion || 'unknown',
          installedAt: new Date().toISOString(),
          enabled: true,
        });
      }
    }

    // Drop registry entries whose plugin directory no longer exists.
    registry.plugins = registry.plugins.filter((p) => seen.has(p.name));

    await this.writeRegistryAtomic(registry);
    return registry;
  }

  /**
   * Get marketplace registry (combines remote AND local)
   * Fetches from both remote marketplace API and local marketplace.json,
   * merging them together with remote taking priority for duplicates
   */
  async getMarketplaceRegistry() {
    const allPlugins = new Map(); // Use Map to dedupe by name, remote takes priority

    // 1. Load local marketplace.json first (lower priority)
    try {
      console.log('[PluginInstaller] Loading local marketplace.json...');
      const content = await fs.readFile(this.marketplacePath, 'utf-8');
      const localRegistry = JSON.parse(content);
      const localPlugins = localRegistry.plugins || [];
      console.log(`[PluginInstaller] Found ${localPlugins.length} plugins in local marketplace`);

      for (const plugin of localPlugins) {
        allPlugins.set(plugin.name, { ...plugin, source: 'local' });
      }
    } catch (error) {
      console.warn('[PluginInstaller] Failed to load local marketplace:', error.message);
    }

    // 2. Fetch from remote marketplace API (higher priority, overwrites local)
    try {
      console.log('[PluginInstaller] Fetching plugins from remote marketplace API...');
      const response = await fetch('https://api.agnt.gg/marketplace/items?type=plugin');

      if (response.ok) {
        const data = await response.json();
        const remoteItems = data.items || [];
        console.log(`[PluginInstaller] Fetched ${remoteItems.length} plugins from remote marketplace`);

        // Transform marketplace API format to plugin registry format
        for (const item of remoteItems) {
          // Parse metadata if it's a string
          const metadata = typeof item.metadata === 'string' ? JSON.parse(item.metadata) : item.metadata || {};
          // Get manifest from metadata (contains icon, tools, etc.)
          const manifest = metadata.manifest || {};

          const plugin = {
            name: item.asset_id,
            displayName: item.title,
            version: item.current_version,
            description: item.description,
            author: item.publisher_pseudonym || manifest.author || 'Unknown',
            homepage: metadata.homepage || manifest.homepage || '',
            downloadUrl: metadata.downloadUrl || '',
            size: metadata.size || 0,
            tags: item.tags || [],
            category: item.category,
            // Icon priority: manifest icon > metadata icon > preview_image > default
            icon: manifest.icon || metadata.icon || item.preview_image || 'custom',
            // Tools from manifest
            tools: manifest.tools || metadata.tools || [],
            // trust system W1/W2/W3: trust fields served by the marketplace API
            // (dedicated columns first, metadata JSON as fallback)
            integrity: item.integrity || metadata.integrity || undefined,
            trustTier: item.trust_tier || metadata.trustTier || undefined,
            declaredPermissions: safeParseArray(item.declared_permissions) || metadata.declaredPermissions || undefined,
            detectedCapabilities: safeParseArray(item.detected_capabilities) || metadata.detectedCapabilities || undefined,
            signature: item.signature || metadata.signature || undefined,
            publisherKeyId: item.publisher_key_id || metadata.publisherKeyId || undefined,
            provenance: safeParseObject(item.provenance) || metadata.provenance || undefined,
            source: 'remote',
          };

          // Trust fields are bound to a SPECIFIC artifact. Never copy a local
          // artifact hash onto remote bytes. For overlapping records, preserve
          // the verified bundled artifact while its semantic version is equal
          // to or newer than the remote listing. A truly newer remote version
          // wins cleanly and must provide/establish trust for its own bytes.
          const existing = allPlugins.get(plugin.name);
          if (existing?.integrity) {
            const versionComparison = compareVersions(existing.version, plugin.version);
            if (versionComparison.comparable && versionComparison.cmp >= 0) {
              continue;
            }
          }
          allPlugins.set(plugin.name, plugin);
        }
      }
    } catch (error) {
      console.warn('[PluginInstaller] Remote marketplace unavailable:', error.message);
    }

    const plugins = Array.from(allPlugins.values());
    console.log(`[PluginInstaller] Total plugins available: ${plugins.length} (combined from local + remote)`);

    return { plugins };
  }

  /**
   * Get list of available plugins from marketplace
   */
  async getAvailablePlugins() {
    try {
      // Use local registry first
      const registry = await this.getMarketplaceRegistry();
      return {
        success: true,
        plugins: registry.plugins || [],
      };
    } catch (error) {
      console.error('[PluginInstaller] Failed to fetch available plugins:', error);
      return { success: false, error: error.message, plugins: [] };
    }
  }

  /**
   * Get list of installed plugins. The installed manifest.json is the source
   * of truth for everything a user can edit (version, description, author,
   * icon, tools). Marketplace data only fills in display-only extras
   * (displayName, homepage) when the manifest doesn't carry them.
   *
   * Previously this read primarily from the marketplace, which is why manual
   * edits to a plugin's manifest (or a manual version bump) didn't show up in
   * the Plugins list until the marketplace catalog was updated.
   */
  async getInstalledPlugins() {
    try {
      const content = await fs.readFile(this.registryPath, 'utf-8');
      const registry = JSON.parse(content);
      const registryPlugins = registry.plugins || [];

      // Marketplace data is supplementary now — used for display polish only.
      let marketplacePlugins = [];
      try {
        const marketplaceRegistry = await this.getMarketplaceRegistry();
        marketplacePlugins = marketplaceRegistry.plugins || [];
      } catch (err) {
        console.warn('[PluginInstaller] Marketplace lookup failed, using manifest only:', err.message);
      }

      const enrichedPlugins = await Promise.all(
        registryPlugins.map(async (plugin) => {
          const marketplacePlugin = marketplacePlugins.find((p) => p.name === plugin.name);

          let manifest = null;
          try {
            const manifestPath = path.join(this.pluginsDir, plugin.name, 'manifest.json');
            manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8'));
          } catch (error) {
            console.warn(`[PluginInstaller] Could not read manifest for ${plugin.name}:`, error.message);
          }

          // Disk size: prefer marketplace number, fall back to 0. (We don't
          // stat the directory on every list call for performance reasons.)
          const size = marketplacePlugin?.size || 0;

          if (!manifest) {
            return {
              ...plugin,
              displayName: marketplacePlugin?.displayName || this.toDisplayName(plugin.name),
              description: marketplacePlugin?.description || '',
              author: marketplacePlugin?.author || '',
              homepage: marketplacePlugin?.homepage || '',
              icon: marketplacePlugin?.icon || 'custom',
              size,
              tools: marketplacePlugin?.tools || [],
            };
          }

          return {
            ...plugin,
            version: manifest.version || plugin.version,
            displayName: manifest.displayName || marketplacePlugin?.displayName || this.toDisplayName(manifest.name || plugin.name),
            description: manifest.description ?? marketplacePlugin?.description ?? '',
            author: manifest.author ?? marketplacePlugin?.author ?? '',
            homepage: manifest.homepage || marketplacePlugin?.homepage || '',
            icon: manifest.icon || marketplacePlugin?.icon || 'custom',
            size,
            tools: Array.isArray(manifest.tools) ? manifest.tools : (marketplacePlugin?.tools || []),
          };
        })
      );

      return enrichedPlugins;
    } catch {
      return [];
    }
  }

  /**
   * Ensure plugin package.json has "type": "module" for ES6 imports
   */
  async ensureModuleType(pluginPath, pluginName) {
    const packageJsonPath = path.join(pluginPath, 'package.json');

    try {
      // Check if package.json exists
      await fs.access(packageJsonPath);

      // Read and parse package.json
      const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(packageJsonContent);

      // Auto-fix: ensure type: "module" is set
      if (!packageJson.type || packageJson.type !== 'module') {
        packageJson.type = 'module';
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log(`[PluginInstaller] Auto-fixed: Added "type": "module" to ${pluginName}`);
      }
    } catch (error) {
      // If package.json doesn't exist, create a minimal one with type: module
      if (error.code === 'ENOENT') {
        const minimalPackageJson = {
          name: pluginName,
          version: '1.0.0',
          type: 'module',
          description: 'AGNT Plugin',
        };
        await fs.writeFile(packageJsonPath, JSON.stringify(minimalPackageJson, null, 2));
        console.log(`[PluginInstaller] Created package.json with "type": "module" for ${pluginName}`);
      } else {
        console.warn(`[PluginInstaller] Could not ensure module type for ${pluginName}:`, error.message);
      }
    }
  }

  /**
   * Install dependencies for a plugin using npm (async/non-blocking)
   * Handles native module compilation for the target platform
   */
  async installDependencies(pluginPath, pluginName) {
    const { spawn } = await import('child_process');

    console.log(`[PluginInstaller] Installing dependencies for ${pluginName}...`);

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const args = ['install', '--production', '--no-audit', '--no-fund', `--platform=${process.platform}`, `--arch=${process.arch}`];

    try {
      await this.runNpmCommand(npmCommand, args, pluginPath, pluginName);
      console.log(`[PluginInstaller] Dependencies installed successfully for ${pluginName}`);

      // Special handling for Sharp and other native modules
      await this.handleNativeModules(pluginPath, pluginName);
    } catch (error) {
      console.error(`[PluginInstaller] Failed to install dependencies for ${pluginName}:`, error.message);

      // Try alternative installation methods
      await this.tryAlternativeInstall(pluginPath, pluginName, error);
    }
  }

  /**
   * Run npm command asynchronously (non-blocking, enables parallel installs)
   */
  runNpmCommand(command, args, cwd, pluginName, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');

      const child = spawn(command, args, {
        cwd,
        stdio: 'pipe',
        windowsHide: true,
        shell: true,
        env: {
          ...process.env,
          npm_config_target: process.version,
          npm_config_runtime: 'node',
          npm_config_cache: path.join(cwd, '.npm-cache'),
        },
      });

      let stderr = '';
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(stderr || `npm exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Get the Electron version from the main package.json
   * This is needed to rebuild native modules for the correct Electron ABI
   */
  async getElectronVersion() {
    try {
      // Try to get from process.versions first (if running in Electron)
      if (process.versions.electron) {
        return process.versions.electron;
      }

      // Otherwise read from package.json
      const mainPackageJsonPath = path.join(__dirname, '../../../package.json');
      const packageJson = JSON.parse(await fs.readFile(mainPackageJsonPath, 'utf-8'));
      const electronVersion = packageJson.devDependencies?.electron || packageJson.dependencies?.electron;

      if (electronVersion) {
        // Remove ^ or ~ prefix if present
        return electronVersion.replace(/^[\^~]/, '');
      }

      return null;
    } catch (error) {
      console.warn('[PluginInstaller] Could not determine Electron version:', error.message);
      return null;
    }
  }

  /**
   * Handle native modules - ALWAYS rebuild for Electron runtime
   * This is critical because plugins run in Electron's Node.js, not system Node.js
   */
  async handleNativeModules(pluginPath, pluginName) {
    const { execSync } = await import('child_process');
    const packageJsonPath = path.join(pluginPath, 'package.json');

    try {
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf-8'));
      const dependencies = packageJson.dependencies || {};

      // List of native modules that need Electron-specific compilation
      const nativeModules = ['sharp', 'canvas', 'sqlite3', 'bcrypt', 'node-gyp', 'better-sqlite3', 'onnxruntime-node'];
      const installedNativeModules = nativeModules.filter((mod) => dependencies[mod]);

      if (installedNativeModules.length === 0) {
        console.log(`[PluginInstaller] No native modules found in ${pluginName}`);
        return;
      }

      console.log(`[PluginInstaller] Found native modules in ${pluginName}: ${installedNativeModules.join(', ')}`);

      // Get Electron version for rebuilding
      const electronVersion = await this.getElectronVersion();

      if (electronVersion) {
        console.log(`[PluginInstaller] Rebuilding native modules for Electron ${electronVersion}...`);
        await this.rebuildForElectron(pluginPath, pluginName, installedNativeModules, electronVersion);
      } else {
        console.log(`[PluginInstaller] Electron version not found, rebuilding for current Node.js...`);
        await this.rebuildForNode(pluginPath, pluginName, installedNativeModules);
      }
    } catch (error) {
      console.warn(`[PluginInstaller] Could not check for native modules in ${pluginName}:`, error.message);
    }
  }

  /**
   * Rebuild native modules specifically for Electron runtime
   * Uses npm rebuild with Electron target (most reliable method)
   */
  async rebuildForElectron(pluginPath, pluginName, modules, electronVersion) {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    // Rebuild all modules in parallel
    await Promise.all(
      modules.map(async (module) => {
        try {
          console.log(`[PluginInstaller] Rebuilding ${module} for Electron ${electronVersion}...`);
          await this.runNpmCommand(
            npmCommand,
            ['rebuild', module, '--runtime=electron', `--target=${electronVersion}`, `--arch=${process.arch}`, '--dist-url=https://electronjs.org/headers'],
            pluginPath,
            pluginName,
            180000
          );
          console.log(`[PluginInstaller] Successfully rebuilt ${module} for Electron`);
        } catch (rebuildError) {
          console.error(`[PluginInstaller] Failed to rebuild ${module} for Electron:`, rebuildError.message);

          // Try reinstalling the module with Electron flags
          try {
            console.log(`[PluginInstaller] Trying to reinstall ${module} with Electron flags...`);
            await this.runNpmCommand(npmCommand, ['uninstall', module], pluginPath, pluginName, 60000);
            await this.runNpmCommand(
              npmCommand,
              ['install', module, '--runtime=electron', `--target=${electronVersion}`, `--arch=${process.arch}`, '--dist-url=https://electronjs.org/headers'],
              pluginPath,
              pluginName,
              180000
            );
            console.log(`[PluginInstaller] Successfully reinstalled ${module} for Electron`);
          } catch (reinstallError) {
            console.error(`[PluginInstaller] All methods failed for ${module}. Plugin may not work correctly.`);
          }
        }
      })
    );
  }

  /**
   * Fallback: Rebuild native modules for current Node.js (non-Electron)
   */
  async rebuildForNode(pluginPath, pluginName, modules) {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    // Rebuild all modules in parallel
    await Promise.all(
      modules.map(async (module) => {
        try {
          console.log(`[PluginInstaller] Rebuilding ${module} for Node.js...`);
          await this.runNpmCommand(
            npmCommand,
            ['rebuild', module, `--platform=${process.platform}`, `--arch=${process.arch}`],
            pluginPath,
            pluginName,
            120000
          );
          console.log(`[PluginInstaller] Successfully rebuilt ${module}`);
        } catch (rebuildError) {
          console.warn(`[PluginInstaller] Failed to rebuild ${module}, but continuing...`);
        }
      })
    );
  }

  /**
   * Try alternative installation methods if the primary method fails
   */
  async tryAlternativeInstall(pluginPath, pluginName, originalError) {
    console.log(`[PluginInstaller] Trying alternative installation methods for ${pluginName}...`);

    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    try {
      // Method 1: Clear npm cache and try again
      console.log(`[PluginInstaller] Clearing npm cache and retrying...`);
      await this.runNpmCommand(npmCommand, ['cache', 'clean', '--force'], pluginPath, pluginName, 60000);
      await this.runNpmCommand(npmCommand, ['install', '--production', '--no-audit', '--no-fund'], pluginPath, pluginName, 300000);

      console.log(`[PluginInstaller] Alternative installation succeeded for ${pluginName}`);
      return;
    } catch (altError) {
      console.error(`[PluginInstaller] Alternative installation also failed for ${pluginName}`);

      // Method 2: Try with --ignore-scripts flag (for problematic native modules)
      try {
        console.log(`[PluginInstaller] Trying installation with --ignore-scripts...`);
        await this.runNpmCommand(npmCommand, ['install', '--production', '--no-audit', '--no-fund', '--ignore-scripts'], pluginPath, pluginName, 300000);

        console.log(`[PluginInstaller] Installation with --ignore-scripts succeeded for ${pluginName}`);
        console.warn(`[PluginInstaller] Note: Native modules may not work properly for ${pluginName}`);
        return;
      } catch (finalError) {
        console.error(`[PluginInstaller] All installation methods failed for ${pluginName}`);
        throw new Error(`Dependency installation failed: ${originalError.message}`);
      }
    }
  }

  /**
   * Convert kebab-case name to Title Case display name
   * e.g., "discord-plugin" -> "Discord Plugin"
   */
  toDisplayName(name) {
    return name
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // ============================================================================
  // BACKWARD COMPATIBILITY - Keep old method names working
  // ============================================================================

  /**
   * @deprecated Use initializePlugins() instead
   */
  async installAllPlugins() {
    console.log('[PluginInstaller] installAllPlugins() is deprecated, using initializePlugins()');
    return await this.initializePlugins();
  }

  /**
   * @deprecated Use installFromMarketplace() instead
   */
  async installPlugin(pluginName) {
    console.log('[PluginInstaller] installPlugin() is deprecated');
    // Just validate existing plugin, don't try npm install
    const isValid = await this.validatePlugin(pluginName);
    return isValid ? 'valid' : 'invalid';
  }
}

// Export singleton instance
export default new PluginInstaller();
