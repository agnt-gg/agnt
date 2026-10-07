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
import { execFile } from 'node:child_process';

export const LOCAL_SERVER_URL = 'http://127.0.0.1:1234/v1';
export const LMSTUDIO_DOWNLOAD_URL = 'https://lmstudio.ai/download';
const START_TIMEOUT_MS = 60_000;
const READY_WAIT_MS = 30_000;

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
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  candidates = lmsCandidates,
  hosted = () => false,
} = {}) {
  const findLms = () => candidates().find((file) => exists(file)) || null;

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
      await run(lms, ['server', 'start'], START_TIMEOUT_MS);
    } catch (error) {
      const detail = String(error?.stderr || error?.stdout || error?.message || '').trim().slice(0, 300);
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

  return { status, start };
}
