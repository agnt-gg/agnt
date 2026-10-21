/**
 * "Run a model on this machine": find LM Studio, start its server, report models.
 *
 * AGNT's Local provider talks to LM Studio's OpenAI-compatible server on
 * 127.0.0.1:1234. The link that selects it used to do nothing visible when that
 * server was not running: Local was selected with no models and no word why.
 * LM Studio ships a CLI (`lms server start`, https://lmstudio.ai/docs/cli) that
 * starts the server headless, so when LM Studio is installed AGNT can start it
 * for the user instead of telling them to.
 *
 * Probing localhost happens here, not in the renderer: the browser cannot read
 * another origin's port without CORS, and only the backend can find and run the
 * CLI. Nothing here installs software; when LM Studio is missing the app offers
 * the download page and waits for it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';

export const LOCAL_SERVER_URL = 'http://127.0.0.1:1234/v1';
/** LM Studio's native REST API: reports each model's type, state and loaded context. */
export const LMSTUDIO_NATIVE_MODELS_URL = 'http://127.0.0.1:1234/api/v0/models';
export const LMSTUDIO_DOWNLOAD_URL = 'https://lmstudio.ai/download';
/** Waking LM Studio's service from cold takes well over 30s on a slow disk. */
const READY_WAIT_MS = 90_000;
const LOAD_TIMEOUT_MS = 180_000;
/**
 * Context a chat turn needs. One AGNT turn with its tool list measured about
 * 22.7K input tokens (2026-10-21), and LM Studio's own default load is 4096,
 * which refuses every turn. 32K leaves room for the conversation.
 */
export const LOCAL_CHAT_CONTEXT = 32_768;

const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

/** Where LM Studio puts its CLI, newest layout first, then PATH. */
export function lmsCandidates(home = os.homedir(), envPath = process.env.PATH || '') {
  const bins = [path.join(home, '.lmstudio', 'bin', exe('lms')), path.join(home, '.cache', 'lm-studio', 'bin', exe('lms'))];
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) bins.push(path.join(dir, exe('lms')));
  return [...new Set(bins)];
}

export function createLocalModelRuntime({
  fetchImpl = (...args) => fetch(...args),
  exists = (file) => { try { return fs.statSync(file).isFile(); } catch { return false; } },
  run = (file, args, timeout) => new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true }, (error, stdout, stderr) => (error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr })));
  }),
  // `lms server start` wakes LM Studio's background service, which inherits
  // the command's stdout/stderr and keeps them open for as long as it runs.
  // execFile reports only once those pipes close, so awaiting it never
  // finished: the "Starting LM Studio" dialog sat until the timeout killed
  // lms, and then reported a failure while the server was coming up
  // (2026-10-21). Detached with no pipes, whether it worked is read from the
  // server itself.
  launch = (file, args) => new Promise((resolve, reject) => {
    const child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  }),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  candidates = lmsCandidates,
  hosted = () => false,
} = {}) {
  const findLms = () => candidates().find((file) => exists(file)) || null;

  /** LM Studio's per-model view, or null when it cannot be read (not LM Studio, or too old). */
  async function nativeModels() {
    try {
      const response = await fetchImpl(LMSTUDIO_NATIVE_MODELS_URL, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return null;
      const body = await response.json();
      return Array.isArray(body?.data) ? body.data : null;
    } catch {
      return null;
    }
  }

  async function listModels() {
    try {
      const response = await fetchImpl(`${LOCAL_SERVER_URL}/models`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) return null;
      const body = await response.json();
      return (body?.data || []).map((model) => model.id).filter(Boolean);
    } catch {
      return null; // not listening
    }
  }

  /** { running, models, installed, canStart, downloadUrl } */
  async function status() {
    const models = await listModels();
    const lms = hosted() ? null : findLms();
    return {
      running: models !== null,
      models: models || [],
      installed: !!lms,
      canStart: !!lms && models === null,
      downloadUrl: LMSTUDIO_DOWNLOAD_URL,
    };
  }

  /** Start LM Studio's server if it is installed and stopped, then wait for it. */
  async function start() {
    if (hosted()) return { ...(await status()), error: 'not_available_on_hosted' };
    const before = await status();
    if (before.running) return before;
    const lms = findLms();
    if (!lms) return { ...before, error: 'not_installed' };
    try {
      await launch(lms, ['server', 'start']);
    } catch (error) {
      const detail = String(error?.message || '').trim().slice(0, 300);
      console.warn('[localModelRuntime] lms server start failed:', detail);
      return { ...(await status()), error: 'start_failed', detail };
    }
    const deadline = Date.now() + READY_WAIT_MS;
    for (;;) {
      const now = await status();
      if (now.running || Date.now() >= deadline) return now.running ? now : { ...now, error: 'start_timeout' };
      await sleep(1000);
    }
  }

  /**
   * Make an LM Studio model able to run a chat turn before AGNT switches to it.
   *
   * LM Studio loads a model with its own default context (4096), and AGNT's
   * Local provider rightly refuses a turn that does not fit rather than
   * truncating it. So picking a model used to switch the account to it and
   * fail the very first message (2026-10-21). Here a chat model loaded too
   * small, or not loaded, is (re)loaded with LOCAL_CHAT_CONTEXT, or its own
   * maximum when that is smaller, under the same identifier, and verified.
   *
   * @param {string} [modelId] the model to use; defaults to the loaded chat
   *   model, else the first chat model
   * @returns {Promise<{ model?: string, contextLength?: number, reloaded?: boolean, error?: string, detail?: string }>}
   */
  async function prepare(modelId) {
    if (hosted()) return { error: 'not_available_on_hosted' };
    const models = await nativeModels();
    // Not LM Studio's API (Ollama, llama-server, AGNT's own runtime size their
    // own context): nothing to prepare here.
    if (!models) return { model: modelId || null, skipped: true };
    const chat = models.filter((entry) => entry?.type !== 'embeddings');
    const target = modelId
      ? chat.find((entry) => entry.id === modelId)
      : chat.find((entry) => entry.state === 'loaded') || chat[0];
    if (!target) return { error: modelId ? 'model_not_found' : 'no_chat_model', detail: modelId || '' };

    const want = Math.min(LOCAL_CHAT_CONTEXT, Number(target.max_context_length) || LOCAL_CHAT_CONTEXT);
    if (target.state === 'loaded' && Number(target.loaded_context_length) >= want) {
      return { model: target.id, contextLength: Number(target.loaded_context_length), reloaded: false };
    }
    const lms = findLms();
    if (!lms) return { error: 'not_installed', model: target.id };
    try {
      if (target.state === 'loaded') await run(lms, ['unload', target.id], LOAD_TIMEOUT_MS);
      await run(lms, ['load', target.id, '--context-length', String(want), '--identifier', target.id, '--yes'], LOAD_TIMEOUT_MS);
    } catch (error) {
      const detail = String(error?.stderr || error?.stdout || error?.message || '').trim().slice(0, 300);
      console.warn(`[localModelRuntime] could not load ${target.id} with ${want} context:`, detail);
      return { error: 'load_failed', model: target.id, contextLength: want, detail };
    }
    const after = (await nativeModels())?.find((entry) => entry.id === target.id);
    const loaded = Number(after?.loaded_context_length) || 0;
    if (after?.state !== 'loaded' || loaded < want) {
      return { error: 'load_failed', model: target.id, contextLength: want, detail: `LM Studio reports ${after?.state || 'no'} model with ${loaded} context` };
    }
    console.log(`[localModelRuntime] loaded ${target.id} with ${loaded} context`);
    return { model: target.id, contextLength: loaded, reloaded: true };
  }

  return { status, start, prepare };
}
