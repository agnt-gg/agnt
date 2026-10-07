/**
 * AGNT's own local model server: llama.cpp's llama-server, installed and run
 * by AGNT so "run a model on this computer" needs nothing else installed.
 *
 * One click does: detect the hardware, pick the matching pinned llama.cpp
 * build, download it and one model (resumable, SHA-256 verified), start
 * llama-server on a free loopback port, and make that model the Local model.
 *
 * Memory placement is llama.cpp's `--fit on`: it fills free VRAM, puts the
 * rest in RAM and sizes the context to what is left, never below
 * CONTEXT_FLOOR. So there are no GPU-layer or context knobs to get wrong.
 *
 * Lifecycle. The server starts on first use (the Local client calls
 * ensureRunning per request), stops after IDLE_MS without requests to free the
 * GPU, and stops with the backend's graceful shutdown. On Windows an update
 * kills the backend with TerminateProcess, which skips that shutdown and
 * orphans the child; its pid and port are recorded, so the next backend adopts
 * the still-running server instead of starting a second one.
 *
 * Layout under rootDir:
 *   engine/<tag>-<build>/   extracted llama.cpp build (+ .installed marker)
 *   models/<file>.gguf      verified model files
 *   downloads/              in-progress .part files, kept for resume
 *   state.json              { activeModelId, server: { pid, port, modelId } }
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { ENGINE_TAG, ENGINE_BUILDS, MODELS, fitModel, recommendModel } from './catalog.js';
import { detectHardware as detectHardwareDefault, pickEngineBuild } from './hardware.js';
import { downloadVerified } from './download.js';

export const CONTEXT_FLOOR = 32768;
/**
 * Thinking-token cap. Unbounded, Qwen 3.5 4B spent all 2048 tokens of a
 * one-sentence question thinking (10 215 chars) and answered nothing, 34 s on
 * a GTX 1660 SUPER. The server ends the thought at this budget and answers.
 */
export const REASONING_BUDGET_TOKENS = 1024;
const READY_TIMEOUT_MS = 3 * 60_000;
const IDLE_MS = 30 * 60_000;
const STDERR_TAIL_LINES = 40;
const DISK_HEADROOM_BYTES = 1024 ** 3;
const INSTALLED_MARKER = '.installed';

export class ManagedRuntimeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ManagedRuntimeError';
    this.code = code;
  }
}

const serverBinaryName = (platform) => (platform === 'win32' ? 'llama-server.exe' : 'llama-server');

/** Windows' own bsdtar reads .zip; a Git-for-Windows GNU tar earlier on PATH does not. */
function systemTar(platform = process.platform) {
  return platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
}

/** bsdtar and GNU tar both refuse `..` and absolute member paths by default. */
const extractArchiveDefault = (archive, destDir) =>
  new Promise((resolve, reject) => {
    execFile(systemTar(), ['-xf', archive, '-C', destDir], { windowsHide: true, timeout: 10 * 60_000 }, (error, _stdout, stderr) =>
      error ? reject(new ManagedRuntimeError('extract_failed', `Could not unpack ${path.basename(archive)}: ${String(stderr || error.message).trim().slice(0, 300)}`)) : resolve(),
    );
  });

const freePortDefault = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const spawnDefault = (file, args, options) => spawn(file, args, { ...options, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

const isAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function exists(file) {
  try {
    await fsp.access(file);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(file) {
  try {
    return (await fsp.stat(file)).size;
  } catch {
    return -1;
  }
}

/** Depth-limited search: archives put binaries at the root or one folder down. */
async function findFile(dir, name, depth = 3) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const hit = entries.find((entry) => entry.isFile() && entry.name === name);
  if (hit) return path.join(dir, hit.name);
  if (depth <= 0) return null;
  for (const entry of entries.filter((e) => e.isDirectory())) {
    const found = await findFile(path.join(dir, entry.name), name, depth - 1);
    if (found) return found;
  }
  return null;
}

/** Linux loads shared libraries from LD_LIBRARY_PATH, not the binary's folder. */
async function sharedLibraryDirs(dir, depth = 3, found = new Set()) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  if (entries.some((entry) => entry.isFile() && /\.so(\.\d+)*$/.test(entry.name))) found.add(dir);
  if (depth > 0) for (const entry of entries.filter((e) => e.isDirectory())) await sharedLibraryDirs(path.join(dir, entry.name), depth - 1, found);
  return found;
}

export function createManagedRuntime({
  rootDir,
  models: catalogModels = MODELS,
  builds = ENGINE_BUILDS,
  platform = process.platform,
  detectHardware = () => detectHardwareDefault(),
  download = downloadVerified,
  extractArchive = extractArchiveDefault,
  spawnServer = spawnDefault,
  freePort = freePortDefault,
  killProcess = (pid) => process.kill(pid),
  processAlive = isAlive,
  freeDiskBytes = async (dir) => {
    const stats = await fsp.statfs(dir);
    return stats.bavail * stats.bsize;
  },
  fetchImpl = (...args) => fetch(...args),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms).unref?.(),
  readyTimeoutMs = READY_TIMEOUT_MS,
  idleMs = IDLE_MS,
  hosted = () => false,
} = {}) {
  const dirs = {
    engineRoot: path.join(rootDir, 'engine'),
    models: path.join(rootDir, 'models'),
    downloads: path.join(rootDir, 'downloads'),
  };
  const stateFile = path.join(rootDir, 'state.json');

  let hardwarePromise = null;
  let state = null; // { activeModelId, server }
  let child = null; // the llama-server this process spawned
  let server = null; // { pid, port, modelId } when running (spawned or adopted)
  let starting = null; // in-flight ensureRunning, shared by concurrent callers
  let job = null; // setup progress, visible in status()
  let lastUsed = 0;
  let idleTimerArmed = false;
  let stderrTail = [];

  const hardware = () => (hardwarePromise ||= detectHardware());
  const findModel = (id) => catalogModels.find((model) => model.id === id) || null;

  // ── persisted state ──────────────────────────────────────────────
  function loadState() {
    if (state) return state;
    try {
      state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    } catch {
      state = {};
    }
    state.activeModelId = findModel(state.activeModelId) ? state.activeModelId : null;
    return state;
  }

  /** Synchronous so the shutdown path can record a stop before process.exit. */
  function saveState() {
    try {
      fs.mkdirSync(rootDir, { recursive: true });
      const tmp = `${stateFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ activeModelId: state.activeModelId || null, server: server || null }, null, 2));
      fs.renameSync(tmp, stateFile);
    } catch (error) {
      console.warn('[localModels] could not save state:', error.message);
    }
  }

  // ── paths ───────────────────────────────────────────────────────
  async function buildKey() {
    return pickEngineBuild(await hardware());
  }
  const engineDir = (key) => path.join(dirs.engineRoot, `${ENGINE_TAG}-${key}`);
  const modelPath = (model) => path.join(dirs.models, model.file);

  async function engineInstalled(key) {
    return !!key && (await exists(path.join(engineDir(key), INSTALLED_MARKER)));
  }
  /** A file at the final path is verified by construction (download.js renames only after the hash matches). */
  async function modelDownloaded(model) {
    return (await fileSize(modelPath(model))) === model.size;
  }

  // ── status ──────────────────────────────────────────────────────
  const baseURL = () => (server ? `http://127.0.0.1:${server.port}/v1` : null);
  const activeModelId = () => loadState().activeModelId;
  const runningModelId = () => server?.modelId || null;

  /** The active model can be served without a download: engine and file are on disk. */
  async function activeModelReady() {
    const model = findModel(activeModelId());
    if (!model || hosted()) return false;
    return (await engineInstalled(await buildKey())) && (await modelDownloaded(model));
  }

  function jobSnapshot() {
    if (!job) return null;
    const { controller, ...visible } = job;
    return { ...visible };
  }

  async function status() {
    const hw = await hardware();
    const key = pickEngineBuild(hw);
    const recommended = recommendModel(hw, catalogModels);
    const gpu = hw.gpus[0] || null;
    const models = await Promise.all(
      catalogModels.map(async (model) => ({
        id: model.id,
        name: model.name,
        blurb: model.blurb,
        sizeBytes: model.size,
        fit: fitModel(model, hw),
        downloaded: await modelDownloaded(model),
        recommended: model.id === recommended?.id,
      })),
    );
    return {
      supported: !!key && !hosted(),
      hardware: {
        gpu: hw.unifiedMemory ? 'Apple Silicon (unified memory)' : gpu?.name || null,
        vramBytes: gpu?.vramBytes || 0,
        ramBytes: hw.ramBytes,
      },
      engine: {
        tag: ENGINE_TAG,
        build: key,
        label: builds[key]?.label || null,
        bytes: (builds[key]?.files || []).reduce((sum, file) => sum + file.size, 0),
        installed: await engineInstalled(key),
      },
      models,
      recommendedId: recommended?.id || null,
      activeModelId: activeModelId(),
      server: server ? { port: server.port, modelId: server.modelId, baseURL: baseURL() } : null,
      job: jobSnapshot(),
    };
  }

  // ── install ─────────────────────────────────────────────────────
  async function ensureDiskSpace(bytesNeeded) {
    if (bytesNeeded <= 0) return;
    let free;
    try {
      free = await freeDiskBytes(rootDir);
    } catch {
      return; // cannot tell: let the download itself fail if the disk fills
    }
    if (free < bytesNeeded + DISK_HEADROOM_BYTES) {
      const gb = (bytes) => (bytes / 1024 ** 3).toFixed(1);
      throw new ManagedRuntimeError('disk_full', `Not enough disk space: this needs ${gb(bytesNeeded)} GB and ${gb(free)} GB is free.`);
    }
  }

  async function installEngine(key, signal, onProgress) {
    const build = builds[key];
    const dir = engineDir(key);
    await fsp.mkdir(dir, { recursive: true });
    let completed = 0;
    for (const file of build.files) {
      const archive = path.join(dirs.downloads, file.name);
      await download({ url: file.url, dest: archive, size: file.size, sha256: file.sha256, signal, onProgress: (done) => onProgress(completed + done) });
      await extractArchive(archive, dir);
      await fsp.rm(archive, { force: true });
      completed += file.size;
    }
    if (!(await findFile(dir, serverBinaryName(platform)))) throw new ManagedRuntimeError('engine_incomplete', 'The llama.cpp download did not contain llama-server.');
    await fsp.writeFile(path.join(dir, INSTALLED_MARKER), `${ENGINE_TAG} ${key}\n`);
  }

  /**
   * Start the one-click setup in the background and return at once; progress
   * is read from status().job. A second call while one runs returns the same
   * job rather than racing it.
   */
  async function setup(modelId) {
    if (hosted()) throw new ManagedRuntimeError('not_available_on_hosted', 'Local models run on your own computer, not on a hosted AGNT.');
    if (job && ['engine', 'model', 'starting'].includes(job.phase)) {
      if (modelId && job.modelId !== modelId) throw new ManagedRuntimeError('busy', `Already setting up ${job.modelId}.`);
      return jobSnapshot();
    }
    const hw = await hardware();
    const key = pickEngineBuild(hw);
    if (!key) throw new ManagedRuntimeError('unsupported_platform', `Local models are not available for ${hw.platform}/${hw.arch}.`);
    const model = modelId ? findModel(modelId) : recommendModel(hw, catalogModels);
    if (!model) throw new ManagedRuntimeError(modelId ? 'unknown_model' : 'no_model_fits', modelId ? `Unknown model "${modelId}".` : 'No model in the catalog fits this computer.');
    if (fitModel(model, hw) === 'too_big') throw new ManagedRuntimeError('too_big', `${model.name} is too large for this computer.`);

    const needEngine = !(await engineInstalled(key));
    const needModel = !(await modelDownloaded(model));
    const engineBytes = needEngine ? builds[key].files.reduce((sum, file) => sum + file.size, 0) : 0;
    const modelBytes = needModel ? model.size : 0;
    const controller = new AbortController();
    job = { modelId: model.id, phase: needEngine ? 'engine' : needModel ? 'model' : 'starting', bytesDone: 0, bytesTotal: engineBytes + modelBytes, error: null, errorCode: null, controller };
    const current = job;
    // A cancel can land between phases, when no download is listening for it.
    const checkCancelled = () => controller.signal.throwIfAborted();

    (async () => {
      try {
        await fsp.mkdir(dirs.downloads, { recursive: true });
        await fsp.mkdir(dirs.models, { recursive: true });
        await ensureDiskSpace(engineBytes + modelBytes);
        if (needEngine) {
          checkCancelled();
          current.phase = 'engine';
          await installEngine(key, controller.signal, (done) => { current.bytesDone = done; });
        }
        if (needModel) {
          checkCancelled();
          current.phase = 'model';
          await download({
            url: model.url,
            dest: modelPath(model),
            size: model.size,
            sha256: model.sha256,
            signal: controller.signal,
            onProgress: (done) => { current.bytesDone = engineBytes + done; },
          });
        }
        checkCancelled();
        current.bytesDone = current.bytesTotal;
        current.phase = 'starting';
        loadState().activeModelId = model.id;
        saveState();
        await ensureRunning(model.id);
        current.phase = 'ready';
      } catch (error) {
        const cancelled = controller.signal.aborted;
        current.phase = cancelled ? 'cancelled' : 'error';
        current.errorCode = cancelled ? 'cancelled' : error.code || 'setup_failed';
        current.error = cancelled ? 'Setup was cancelled. Downloaded parts are kept, so it resumes where it stopped.' : error.message;
        if (!cancelled) console.warn('[localModels] setup failed:', error);
      }
    })();
    return jobSnapshot();
  }

  function cancel() {
    if (job && ['engine', 'model'].includes(job.phase)) job.controller.abort();
    return jobSnapshot();
  }

  // ── server lifecycle ────────────────────────────────────────────
  async function servesModel(port, modelId) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return false;
      const body = await response.json();
      return (body?.data || []).some((entry) => entry?.id === modelId);
    } catch {
      return false;
    }
  }

  /** A server a previous backend started and could not stop (hard kill on Windows). */
  async function adoptOrphan(modelId) {
    const recorded = loadState().server;
    if (!recorded?.pid || !recorded?.port) return false;
    if (recorded.modelId === modelId && processAlive(recorded.pid) && (await servesModel(recorded.port, modelId))) {
      server = { pid: recorded.pid, port: recorded.port, modelId };
      return true;
    }
    if (processAlive(recorded.pid) && (await servesModel(recorded.port, recorded.modelId))) {
      try { killProcess(recorded.pid); } catch { /* already gone */ }
    }
    state.server = null;
    saveState();
    return false;
  }

  async function waitUntilReady(port, exited) {
    const deadline = now() + readyTimeoutMs;
    while (now() < deadline) {
      if (exited.code !== undefined) {
        throw new ManagedRuntimeError('server_exited', `The local model server stopped while loading (exit ${exited.code}). ${stderrTail.slice(-5).join(' ').slice(0, 600)}`);
      }
      try {
        const response = await fetchImpl(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) return; // 503 while the model loads
      } catch {
        // not listening yet
      }
      await sleep(500);
    }
    throw new ManagedRuntimeError('start_timeout', 'The local model server did not finish loading in time.');
  }

  async function spawnFor(model) {
    const key = await buildKey();
    const dir = engineDir(key);
    const binary = await findFile(dir, serverBinaryName(platform));
    if (!binary) throw new ManagedRuntimeError('not_installed', 'The local model engine is not installed.');
    const port = await freePort();
    const env = { ...process.env };
    if (platform === 'linux') {
      env.LD_LIBRARY_PATH = [...(await sharedLibraryDirs(dir)), env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    }
    const args = ['-m', modelPath(model), '--host', '127.0.0.1', '--port', String(port), '--alias', model.id,
      '--fit', 'on', '--fit-ctx', String(CONTEXT_FLOOR), '--reasoning-budget', String(REASONING_BUDGET_TOKENS),
      '--parallel', '1', '--no-webui'];
    stderrTail = [];
    const proc = spawnServer(binary, args, { cwd: path.dirname(binary), env });
    const exited = {};
    const keepTail = (chunk) => {
      stderrTail.push(...String(chunk).split(/\r?\n/).filter(Boolean));
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail = stderrTail.slice(-STDERR_TAIL_LINES);
    };
    proc.stdout?.on('data', keepTail);
    proc.stderr?.on('data', keepTail);
    proc.on('error', (error) => { exited.code = exited.code ?? error.code ?? 'spawn_error'; keepTail(error.message); });
    proc.on('exit', (code, signal) => {
      exited.code = code ?? signal;
      if (child === proc) {
        child = null;
        if (server?.pid === proc.pid) {
          server = null;
          loadState().server = null;
          saveState();
        }
      }
    });
    child = proc;
    try {
      await waitUntilReady(port, exited);
    } catch (error) {
      try { proc.kill(); } catch { /* exited */ }
      child = null;
      throw error;
    }
    server = { pid: proc.pid, port, modelId: model.id };
    loadState().server = server;
    saveState();
  }

  /**
   * The base URL of a server serving `modelId` (default: the active model),
   * starting one if needed. Concurrent callers share one start.
   */
  async function ensureRunning(modelId = activeModelId()) {
    const model = findModel(modelId);
    if (!model) throw new ManagedRuntimeError('no_active_model', 'No local model has been set up yet.');
    if (hosted()) throw new ManagedRuntimeError('not_available_on_hosted', 'Local models run on your own computer, not on a hosted AGNT.');
    if (server?.modelId === model.id) {
      touch();
      return baseURL();
    }
    if (starting?.modelId === model.id) return starting.promise;
    const promise = (async () => {
      if (!(await modelDownloaded(model))) throw new ManagedRuntimeError('not_installed', `${model.name} has not been downloaded.`);
      if (!(await adoptOrphan(model.id))) {
        if (server) stop();
        await spawnFor(model);
      }
      touch();
      return baseURL();
    })();
    starting = { modelId: model.id, promise };
    try {
      return await promise;
    } finally {
      if (starting?.promise === promise) starting = null;
    }
  }

  /** Synchronous: also called from the shutdown drain, which has a hard deadline. */
  function stop() {
    const target = server;
    server = null;
    if (child) {
      try { child.kill(); } catch { /* exited */ }
      child = null;
    } else if (target?.pid && processAlive(target.pid)) {
      try { killProcess(target.pid); } catch { /* exited */ }
    }
    if (state) {
      state.server = null;
      saveState();
    }
  }

  // ── idle shutdown ───────────────────────────────────────────────
  async function busy() {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${server.port}/slots`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) return false;
      const slots = await response.json();
      return Array.isArray(slots) && slots.some((slot) => slot?.is_processing);
    } catch {
      return false;
    }
  }

  async function idleCheck() {
    idleTimerArmed = false;
    if (!server) return;
    const quietFor = now() - lastUsed;
    if (quietFor < idleMs) return armIdleTimer(idleMs - quietFor);
    if (await busy()) {
      lastUsed = now();
      return armIdleTimer(idleMs);
    }
    console.log(`[localModels] stopping idle local model server (${server.modelId}) to free memory`);
    stop();
  }

  function armIdleTimer(ms) {
    if (idleTimerArmed) return;
    idleTimerArmed = true;
    setTimer(() => { idleCheck().catch((error) => console.warn('[localModels] idle check failed:', error.message)); }, ms);
  }

  /** Record use of the server; it stays up while requests keep coming. */
  function touch() {
    lastUsed = now();
    armIdleTimer(idleMs);
  }

  return { status, setup, cancel, ensureRunning, stop, touch, baseURL, activeModelId, runningModelId, activeModelReady, idleCheck };
}
