/**
 * autoUpdate — AGNT keeps itself current.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Until now AGNT could DETECT a new version and could not BECOME one. It polled
 * agnt.gg, showed a banner, and opened a browser at the downloads page — after
 * which the user had to find the installer, quit, run it, and relaunch. So
 * every fix reached only the people who noticed a banner and did five manual
 * steps, and old clients accumulated in the wild. `releases.json` has claimed
 * "Auto-Update System" since v0.3.3; this is the first commit where that is
 * true.
 *
 * ---------------------------------------------------------------------------
 * ONE POLICY, THREE PLATFORMS
 * ---------------------------------------------------------------------------
 * Downloading is silent everywhere. INSTALLING differs, and the difference is
 * not a preference — it is what the platform lets us do safely:
 *
 *   macOS         signed + notarized (Developer ID, notarytool). Squirrel.Mac
 *                 accepts the update, so it lands on quit, silently.
 *   Linux         AppImage self-replaces; same silent-on-quit path.
 *                 deb/rpm are owned by apt/dnf — electron-updater refuses them
 *                 by design, and those users keep the agnt.gg notifier.
 *   Windows       NO code-signing certificate yet. An unsigned NSIS install
 *                 raises SmartScreen, which is a prompt the user must answer,
 *                 so it CANNOT be silent-on-quit: quitting is not consent to a
 *                 UAC dialog appearing on an app the user just closed.
 *                 Windows therefore downloads silently and waits for a click.
 *
 * The user-visible result is that Windows is ONE CLICK behind macOS, not on a
 * different planet: the ~20-50 MB delta is already on disk when the button
 * appears, so "Restart to update" is a restart, not a download.
 *
 * ---------------------------------------------------------------------------
 * WHAT PROTECTS THE UPDATE, WITH NO WINDOWS CERTIFICATE
 * ---------------------------------------------------------------------------
 * `verifyUpdateCodeSignature` is disabled for NSIS in package.json. That is not
 * a weakening: it compares the new installer's publisher against the running
 * app's, and with neither signed there is no publisher to compare — left on, it
 * fails every Windows update. What actually guards the payload:
 *
 *   1. latest.yml carries a sha512 of the installer, and electron-updater
 *      refuses a file whose hash does not match. A corrupted or swapped
 *      artifact is rejected.
 *   2. The feed and the artifacts are fetched over HTTPS from GitHub Releases.
 *
 * The residual risk is someone able to replace latest.yml AT the origin — which
 * is a GitHub account compromise, not something a signature on the installer
 * would have stopped either. A Windows certificate later removes the
 * SmartScreen prompt and lets this flag go back on; it is an upgrade, not a
 * prerequisite.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANT THIS FILE ENFORCES
 * ---------------------------------------------------------------------------
 * NEVER RESTART THE APP TO INSTALL AN UPDATE WHILE A GOAL IS EXECUTING.
 *
 * Same rule as the cluster admission gate and the fleet updater on the tenant
 * host: never destroy running work for an infrastructure reason. A goal can run
 * for forty minutes; killing it at minute thirty-nine to save an hour of
 * staleness is a data-loss event that costs more than the update is worth. The
 * update is already downloaded and goes nowhere — it is postponed, never
 * forgotten.
 */

/**
 * How this platform installs, once a download has landed.
 *
 * @param {string} platform  process.platform
 * @returns {{ autoDownload: boolean, autoInstallOnAppQuit: boolean }}
 */
export function updatePolicy(platform) {
  return {
    // Bandwidth is cheap and blockmap deltas are small; a download the user
    // never asked about is the whole point of "stays up to date".
    autoDownload: true,
    // Windows alone waits for an explicit click — see the header.
    autoInstallOnAppQuit: platform !== 'win32',
  };
}

/** Windows is the one platform that needs a button. */
export function needsExplicitInstall(platform) {
  return platform === 'win32';
}

/**
 * May we restart to install right now?
 *
 * @param {() => Promise<number>} countExecutingGoals
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'goal-running', goals: number }>}
 */
export async function canInstallNow(countExecutingGoals) {
  let running = 0;
  try {
    running = await countExecutingGoals();
  } catch {
    // A database we cannot read is not evidence of running work, and refusing
    // forever would make the button permanently dead — the worst outcome for a
    // control the user is actively pressing. The cost of being wrong here is
    // bounded: the user asked for the restart.
    return { ok: true };
  }
  if (running > 0) return { ok: false, reason: 'goal-running', goals: running };
  return { ok: true };
}

/**
 * Wire electron-updater to the IPC surface the renderer already knows.
 *
 * Every dependency is injected so the policy above can be tested without
 * booting Electron — the parts that matter here are decisions, not plumbing.
 *
 * @param {object} deps
 * @param {object} deps.autoUpdater            electron-updater's autoUpdater
 * @param {object} deps.ipcMain
 * @param {() => object|null} deps.getWindow   the window to notify, or null
 * @param {boolean} deps.isPackaged            never update a dev checkout
 * @param {string} deps.platform
 * @param {() => Promise<number>} deps.countExecutingGoals
 * @param {(...a: any[]) => void} [deps.log]
 * @returns {{ enabled: boolean }}
 */
export function initAutoUpdate({
  autoUpdater,
  ipcMain,
  getWindow,
  isPackaged,
  platform,
  countExecutingGoals,
  log = console.log,
}) {
  const policy = updatePolicy(platform);

  // The renderer asks for these regardless of whether updating is possible, so
  // they are registered unconditionally — a missing handler surfaces as an
  // opaque "no handler for channel" rejection rather than a clear answer.
  ipcMain.handle('update:status', async () => ({
    enabled: isPackaged,
    platform,
    needsExplicitInstall: needsExplicitInstall(platform),
  }));

  ipcMain.handle('update:install', async () => {
    if (!isPackaged) return { ok: false, reason: 'not-packaged' };

    const verdict = await canInstallNow(countExecutingGoals);
    if (!verdict.ok) {
      log(`[update] install refused: ${verdict.goals} goal(s) executing`);
      return verdict;
    }

    log('[update] installing and restarting');
    // isSilent=false so Windows shows its installer UI (there is no silent
    // path without a certificate); isForceRunAfter=true so the user lands back
    // in AGNT rather than at their desktop wondering what happened.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });

  // A dev checkout has no update channel and electron-builder writes no
  // app-update.yml into it. Attempting anyway logs a confusing error on every
  // launch, so the wiring stops here.
  if (!isPackaged) {
    log('[update] dev build — auto-update disabled');
    return { enabled: false };
  }

  autoUpdater.autoDownload = policy.autoDownload;
  autoUpdater.autoInstallOnAppQuit = policy.autoInstallOnAppQuit;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };

  const send = (channel, payload) => {
    const win = getWindow();
    if (win && !win.isDestroyed?.() && win.webContents) win.webContents.send(channel, payload);
  };

  autoUpdater.on('update-available', (info) => {
    log(`[update] ${info?.version} available; downloading`);
    send('update:available', { version: info?.version, notes: info?.releaseNotes });
  });

  autoUpdater.on('download-progress', (p) => {
    send('update:progress', { percent: Math.round(p?.percent ?? 0), bytesPerSecond: p?.bytesPerSecond });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log(`[update] ${info?.version} downloaded`);
    // The renderer decides what to show, and it needs to know whether the user
    // must act: on macOS and Linux this is "installs when you quit", on Windows
    // it is a button.
    send('update:downloaded', {
      version: info?.version,
      needsExplicitInstall: needsExplicitInstall(platform),
    });
  });

  autoUpdater.on('error', (err) => {
    // A failed update check must never be louder than the thing the user is
    // doing. It is logged and dropped; the agnt.gg notifier remains as the
    // visible fallback.
    log(`[update] check failed: ${err?.message || err}`);
  });

  return { enabled: true };
}

export default { initAutoUpdate, updatePolicy, needsExplicitInstall, canInstallNow };
