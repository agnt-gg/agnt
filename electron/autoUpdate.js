/**
 * autoUpdate — AGNT keeps itself current.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Until 0.6.7 AGNT could DETECT a new version and could not BECOME one. It
 * polled agnt.gg, showed a banner, and opened a browser at the downloads page —
 * after which the user had to find the installer, quit, run it, and relaunch.
 * So every fix reached only the people who noticed a banner and did five manual
 * steps, and old clients accumulated in the wild.
 *
 * ---------------------------------------------------------------------------
 * WHERE THE ANSWER COMES FROM
 * ---------------------------------------------------------------------------
 * agnt.gg decides WHICH version to install; GitHub Releases holds the BYTES.
 *
 *   feed    https://agnt.gg/updates/<channel>/latest*.yml   (agnt-server update-feed.js)
 *   files   https://github.com/agnt-gg/agnt/releases/download/v<version>/AGNT-<version>-*
 *
 * The feed is what makes a shipped release controllable: stagingPercentage 0
 * pauses everyone, 10/50/100 rolls out per user, and the channel names the
 * version. Both addresses come from package.json `agntUpdate`, which the build
 * bakes into app.asar, so an installed app cannot be pointed elsewhere by an
 * environment variable.
 *
 * THE PIN. Windows builds are unsigned, so electron-updater cannot verify a
 * publisher, and the feed is served by a web server rather than signed. The
 * client therefore never downloads automatically: it reads the feed, checks that
 * EVERY file it names is  <assetBase>v<version>/AGNT-<version>-...  for exactly
 * the version the feed announced, and only then calls downloadUpdate(). A
 * compromised or misconfigured feed can at worst name a real AGNT release; it
 * cannot send an installer from anywhere else, cannot swap in AGNT-Lite (v0.6.6's
 * published feed did exactly that), and cannot downgrade (allowDowngrade stays
 * off). sha512 in the feed is then checked by electron-updater against the bytes.
 *
 * Prerelease builds (0.6.7-rc.1) follow the `rehearsal` channel, everything else
 * `stable`. Semver orders 0.6.7-rc.1 < 0.6.7-rc.2 < 0.6.7, so a rehearsal
 * install graduates to the release on its own.
 *
 * ---------------------------------------------------------------------------
 * ONE POLICY, FOUR KINDS OF INSTALL
 * ---------------------------------------------------------------------------
 *   macOS     signed + notarized; Squirrel.Mac installs on quit, silently.
 *   AppImage  self-replaces; installs on quit, silently.
 *   deb/rpm   OFF. electron-builder writes resources/package-type and
 *             electron-updater would then install through pkexec — a root
 *             password prompt after the user closed the app. apt/dnf own those
 *             installs; they keep the agnt.gg notifier. Detected by the absence
 *             of $APPIMAGE, which only the AppImage runtime sets.
 *   Windows   NO code-signing certificate. The installer is started with a click
 *             ("Restart to update"), never behind the user's back on quit.
 *
 * ---------------------------------------------------------------------------
 * THE INVARIANT THIS FILE ENFORCES
 * ---------------------------------------------------------------------------
 * NEVER RESTART THE APP TO INSTALL AN UPDATE WHILE WORK IS RUNNING — goals, live
 * chat turns, running workflows, queued tools — unless the user says so after
 * being told what will stop. If the backend cannot say whether it is busy, that
 * is reported as "unknown", never as "idle".
 *
 * Every dependency is injected, so the decisions can be tested without Electron.
 */

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** 'rehearsal' for a prerelease build, 'stable' otherwise. */
export function channelFor(version) {
  const m = SEMVER.exec(String(version || ''));
  return m && m[4] ? 'rehearsal' : 'stable';
}

/**
 * Is this install able to update itself at all, and if not, why not?
 * @returns {{ enabled: true } | { enabled: false, reason: string }}
 */
export function updateSupport({ isPackaged, platform, env = {}, remote = false }) {
  if (!isPackaged) return { enabled: false, reason: 'dev-build' };
  if (platform === 'linux' && !env.APPIMAGE) return { enabled: false, reason: 'linux-package-manager' };
  if (!['win32', 'darwin', 'linux'].includes(platform)) return { enabled: false, reason: 'unsupported-platform' };
  void remote; // remote mode still updates THIS app; only the busy check changes
  return { enabled: true };
}

/** How this platform installs, once a download has landed. */
export function updatePolicy(platform) {
  return {
    // Never automatic: every download is preceded by the pin check below.
    autoDownload: false,
    // Windows alone waits for an explicit click — see the header.
    autoInstallOnAppQuit: platform !== 'win32',
    allowDowngrade: false,
    allowPrerelease: false,
  };
}

/** Windows is the one platform that needs a button. */
export function needsExplicitInstall(platform) {
  return platform === 'win32';
}

/** The generic-provider feed this build follows. */
export function feedUrlFor({ feedBase, version }) {
  if (!/^https?:\/\/.+\/$/.test(feedBase || '')) throw new Error(`agntUpdate.feedBase must be an http(s) URL ending in /: ${feedBase}`);
  return `${feedBase}${channelFor(version)}/`;
}

/**
 * THE PIN. Every file an UpdateInfo names must be an AGNT asset of exactly the
 * announced version, under the configured asset base.
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkUpdateInfo(info, { assetBase, currentVersion }) {
  const version = info?.version;
  const m = SEMVER.exec(String(version || ''));
  if (!m) return { ok: false, reason: `feed version "${version}" is not semver` };
  if (!/^https?:\/\/.+\/$/.test(assetBase || '')) return { ok: false, reason: 'no asset base configured' };
  if (version === currentVersion) return { ok: false, reason: 'feed names the running version' };
  // A prerelease build may only follow prereleases of its own line or the
  // release they lead to; a stable build never takes a prerelease.
  if (channelFor(currentVersion) === 'stable' && m[4]) return { ok: false, reason: `stable build offered prerelease ${version}` };

  const prefix = `${assetBase}v${version}/AGNT-${version}-`;
  const urls = [...(info.files || []).map((f) => f?.url), info.path].filter((u) => u !== undefined);
  if (!info.files || info.files.length === 0) return { ok: false, reason: 'feed lists no files' };
  for (const url of urls) {
    if (typeof url !== 'string' || !url.startsWith(prefix)) return { ok: false, reason: `file outside the pin: ${url}` };
    const rest = url.slice(prefix.length);
    if (!/^[A-Za-z0-9._-]+$/.test(rest) || rest.includes('..')) return { ok: false, reason: `unexpected file name: ${url}` };
  }
  return { ok: true };
}

/**
 * Turn the backend's busy report into a decision.
 * @param {object|null} report  GET /api/system/busy body, or null if unreachable
 * @returns {{ ok: true } | { ok: false, reason: 'busy'|'unknown', busy: object }}
 */
export function installVerdict(report, { force = false } = {}) {
  if (force) return { ok: true };
  if (!report) return { ok: false, reason: 'unknown', busy: { unknown: ['backend'] } };
  const total = ['goals', 'chats', 'workflows', 'tools'].reduce((n, k) => n + (Number(report[k]) || 0), 0);
  if (total > 0) return { ok: false, reason: 'busy', busy: report };
  if (Array.isArray(report.unknown) && report.unknown.length) return { ok: false, reason: 'unknown', busy: report };
  return { ok: true };
}

/**
 * The single source of truth for "where is the update at", owned by main and
 * pushed to every renderer, so a reload or a second window sees the same state.
 */
export function createUpdateState({ version, platform, onChange = () => {} }) {
  let state = {
    phase: 'idle', // idle | checking | available | downloading | ready | installing | error | disabled
    currentVersion: version,
    platform,
    needsExplicitInstall: needsExplicitInstall(platform),
    available: null, // { version }
    percent: null,
    error: null, // { message, during }
    blocked: null, // { reason, busy }
    lastCheckedAt: null,
    installed: null, // { from, to, ok } after a restart
  };
  return {
    get: () => ({ ...state }),
    set(patch) {
      state = { ...state, ...patch };
      onChange({ ...state });
      return state;
    },
  };
}

/**
 * Record, before a restart, which version we expect to come back as; read it on
 * the next launch to say whether the update actually took.
 */
export function createInstallMarker({ fs, file }) {
  return {
    write(from, to) {
      try { fs.writeFileSync(file, JSON.stringify({ from, to, at: new Date().toISOString() })); } catch { /* best effort */ }
    },
    consume(runningVersion) {
      let rec = null;
      try { rec = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
      try { fs.unlinkSync(file); } catch { /* best effort */ }
      if (!rec || !rec.to) return null;
      return { from: rec.from, to: rec.to, ok: rec.to === runningVersion, running: runningVersion };
    },
  };
}

/**
 * Wire electron-updater to main-owned state and the IPC surface.
 *
 * @param {object} deps
 * @param {object} deps.autoUpdater          electron-updater's autoUpdater
 * @param {object} deps.ipcMain
 * @param {() => object[]} deps.getWindows   every window to keep in sync
 * @param {boolean} deps.isPackaged
 * @param {string} deps.platform
 * @param {string} deps.version              the running app version
 * @param {object} deps.config               package.json `agntUpdate`: { feedBase, assetBase }
 * @param {object} [deps.env]
 * @param {() => Promise<object|null>} deps.getBusyReport     null when the backend cannot answer
 * @param {(opts: { force: boolean }) => Promise<{ ok: true } | { ok: false, reason: string, busy?: object }>} deps.handoffBackend
 *        ask the backend to prepare (it re-checks busy atomically) and exit cleanly
 * @param {object} [deps.marker]            createInstallMarker(...)
 * @param {(evt: object, channel: string) => boolean} [deps.refuseSender]  true = refuse (team spaces are remote origins)
 * @param {(...a: any[]) => void} [deps.log]
 * @param {(fn: Function) => void} [deps.defer]
 * @returns {{ enabled: boolean, reason?: string, check: Function, state: object }}
 */
export function initAutoUpdate({
  autoUpdater,
  ipcMain,
  getWindows,
  isPackaged,
  platform,
  version,
  config = {},
  env = {},
  getBusyReport,
  handoffBackend,
  marker = null,
  refuseSender = () => false,
  log = console.log,
  defer = (fn) => setImmediate(fn),
}) {
  const support = updateSupport({ isPackaged, platform, env });
  // Every copy of the state the renderer sees carries `enabled`, pushed or
  // pulled. The banner decides "this build updates itself" from that field; a
  // push without it read as "not enabled" and hid the Restart button the moment
  // the download finished. Found in the update rehearsal.
  const withSupport = (s) => ({ ...s, enabled: support.enabled, disabledReason: support.reason || null });
  const state = createUpdateState({
    version,
    platform,
    onChange: (s) => {
      const payload = withSupport(s);
      for (const win of getWindows() || []) {
        if (win && !win.isDestroyed?.() && win.webContents) win.webContents.send('update:state', payload);
      }
    },
  });

  if (marker) {
    const installed = marker.consume(version);
    if (installed) {
      log(`[update] restarted after installing ${installed.to}: now running ${version} (${installed.ok ? 'ok' : 'MISMATCH'})`);
      state.set({ installed });
    }
  }

  // Handlers are registered unconditionally: the renderer asks regardless, and
  // a missing handler surfaces as an opaque "no handler for channel" rejection.
  ipcMain.handle('update:state', async () => withSupport(state.get()));
  ipcMain.handle('update:check', async (evt) => {
    if (refuseSender(evt, 'update:check')) return { ok: false, reason: 'refused' };
    return check({ userInitiated: true });
  });

  ipcMain.handle('update:install', async (evt, opts = {}) => {
    // A team space is someone else's origin; it may read the state, never
    // restart this machine's app.
    if (refuseSender(evt, 'update:install')) return { ok: false, reason: 'refused' };
    if (!support.enabled) return { ok: false, reason: support.reason };
    if (state.get().phase !== 'ready') return { ok: false, reason: 'not-ready' };
    const report = await getBusyReport().catch(() => null);
    const verdict = installVerdict(report, { force: !!opts.force });
    if (!verdict.ok) {
      log(`[update] install refused (${verdict.reason}): ${JSON.stringify(verdict.busy)}`);
      state.set({ blocked: { reason: verdict.reason, busy: verdict.busy } });
      return verdict;
    }
    const to = state.get().available?.version;
    state.set({ phase: 'installing', blocked: null });
    log(`[update] installing ${to}${opts.force ? ' (forced)' : ''}`);
    try {
      // Hand the backend a clean exit FIRST. On Windows the installer would
      // otherwise taskkill a backend that never ran its shutdown: no journal
      // flush, no workflow teardown, an orphaned workflow helper.
      //
      // The backend re-checks busy itself, atomically with starting its drain,
      // because work can start between the check above and this call. If it
      // refuses, nothing has been stopped and the install is simply postponed.
      const handed = await handoffBackend({ force: !!opts.force });
      if (handed && handed.ok === false && handed.reason === 'busy') {
        log(`[update] backend refused to stop (work started meanwhile): ${JSON.stringify(handed.busy)}`);
        state.set({ phase: 'ready', blocked: { reason: 'busy', busy: handed.busy } });
        return { ok: false, reason: 'busy', busy: handed.busy };
      }
    } catch (err) {
      log(`[update] backend handoff failed, installing anyway: ${err?.message || err}`);
    }
    marker?.write(version, to);
    // isSilent=false: Windows shows its installer UI (no silent path without a
    // certificate). isForceRunAfter=true: the user lands back in AGNT.
    defer(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  });

  if (!support.enabled) {
    log(`[update] auto-update disabled: ${support.reason}`);
    state.set({ phase: 'disabled' });
    return { enabled: false, reason: support.reason, check: async () => null, state };
  }

  const policy = updatePolicy(platform);
  autoUpdater.autoDownload = policy.autoDownload;
  autoUpdater.autoInstallOnAppQuit = policy.autoInstallOnAppQuit;
  autoUpdater.allowDowngrade = policy.allowDowngrade;
  autoUpdater.allowPrerelease = policy.allowPrerelease;
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  const feedUrl = feedUrlFor({ feedBase: config.feedBase, version });
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
  log(`[update] following ${feedUrl}`);

  let userInitiated = false;
  let downloading = null;

  autoUpdater.on('checking-for-update', () => state.set({ phase: 'checking', error: null }));

  autoUpdater.on('update-not-available', () => {
    if (state.get().phase === 'checking') state.set({ phase: 'idle', lastCheckedAt: new Date().toISOString() });
  });

  autoUpdater.on('update-available', (info) => {
    const pin = checkUpdateInfo(info, { assetBase: config.assetBase, currentVersion: version });
    if (!pin.ok) {
      log(`[update] REFUSED ${info?.version}: ${pin.reason}`);
      state.set({ phase: 'error', error: { message: `Update refused: ${pin.reason}`, during: 'verify' } });
      return;
    }
    log(`[update] ${info.version} available; downloading`);
    state.set({ phase: 'downloading', available: { version: info.version }, percent: 0, lastCheckedAt: new Date().toISOString() });
    downloading = autoUpdater.downloadUpdate().catch((err) => {
      log(`[update] download failed: ${err?.message || err}`);
      state.set({ phase: 'error', percent: null, error: { message: String(err?.message || err), during: 'download' } });
    });
  });

  autoUpdater.on('download-progress', (p) => {
    state.set({ phase: 'downloading', percent: Math.round(p?.percent ?? 0) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log(`[update] ${info?.version} downloaded`);
    state.set({ phase: 'ready', percent: 100, available: { version: info?.version } });
  });

  autoUpdater.on('error', (err) => {
    const message = String(err?.message || err);
    log(`[update] error: ${message}`);
    const s = state.get();
    if (s.phase === 'downloading' || s.phase === 'installing' || userInitiated) {
      // Something the user is waiting on: say so, offer Retry.
      state.set({ phase: 'error', percent: null, error: { message, during: s.phase === 'checking' ? 'check' : s.phase } });
    } else if (s.phase === 'checking') {
      // A background check that failed (offline, feed not published) is not
      // news. Quietly back to idle; the next check retries.
      state.set({ phase: 'idle' });
    }
    userInitiated = false;
  });

  let inFlight = null;
  async function check({ userInitiated: byUser = false } = {}) {
    const s = state.get();
    if (s.phase === 'downloading' || s.phase === 'ready' || s.phase === 'installing') return state.get();
    if (inFlight) return inFlight; // dedupe: one check at a time
    userInitiated = byUser;
    inFlight = autoUpdater
      .checkForUpdates()
      .catch(() => null) // surfaced through the 'error' event
      .then(() => downloading)
      .then(() => state.get())
      .finally(() => { inFlight = null; });
    return inFlight;
  }

  return { enabled: true, check, state };
}

export default {
  initAutoUpdate, updatePolicy, updateSupport, needsExplicitInstall, channelFor, feedUrlFor,
  checkUpdateInfo, installVerdict, createUpdateState, createInstallMarker,
};
