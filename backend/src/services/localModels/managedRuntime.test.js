import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createManagedRuntime, CONTEXT_FLOOR, REASONING_BUDGET_TOKENS } from './managedRuntime.js';

const GB = 1024 ** 3;
const MODELS = [
  { id: 'tiny', name: 'Tiny', blurb: '', file: 'tiny.gguf', size: 100, sha256: 'a'.repeat(64), url: 'https://hf.test/tiny.gguf' },
  { id: 'small', name: 'Small', blurb: '', file: 'small.gguf', size: 200, sha256: 'b'.repeat(64), url: 'https://hf.test/small.gguf' },
  { id: 'huge', name: 'Huge', blurb: '', file: 'huge.gguf', size: 500 * GB, sha256: 'c'.repeat(64), url: 'https://hf.test/huge.gguf' },
];
const BUILDS = {
  'win32-x64-cuda12': {
    backend: 'cuda',
    label: 'NVIDIA CUDA 12',
    files: [
      { name: 'llama.zip', size: 10, sha256: 'd'.repeat(64), url: 'https://gh.test/llama.zip' },
      { name: 'cudart.zip', size: 20, sha256: 'e'.repeat(64), url: 'https://gh.test/cudart.zip' },
    ],
  },
};
const HARDWARE = { platform: 'win32', arch: 'x64', ramBytes: 16 * GB, gpus: [{ vendor: 'nvidia', name: 'GTX 1660 SUPER', vramBytes: 6 * GB, driverMajor: 576 }], unifiedMemory: false };

let root;
let clock;
let ports;
let listening; // port -> model id served
let busySlots;
let spawned;
let nextPid;

/** A llama-server stand-in: "listens" once spawned unless told to die while loading. */
function fakeSpawn({ dieWhileLoading = false } = {}) {
  return vi.fn((file, args) => {
    const proc = new EventEmitter();
    proc.pid = nextPid++;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn(() => {
      delete listening[port];
      proc.emit('exit', null, 'SIGTERM');
    });
    const port = Number(args[args.indexOf('--port') + 1]);
    const alias = args[args.indexOf('--alias') + 1];
    spawned.push({ file, args, proc });
    queueMicrotask(() => {
      if (dieWhileLoading) {
        proc.stderr.emit('data', 'CUDA error: out of memory\n');
        proc.emit('exit', 1, null);
      } else listening[port] = alias;
    });
    return proc;
  });
}

function fakeFetch(url) {
  const { port, pathname } = new URL(url);
  const alias = listening[Number(port)];
  if (!alias) return Promise.reject(new Error('ECONNREFUSED'));
  const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
  if (pathname === '/health') return json({ status: 'ok' });
  if (pathname === '/v1/models') return json({ data: [{ id: alias }] });
  if (pathname === '/slots') return json([{ id: 0, is_processing: busySlots }]);
  return Promise.reject(new Error(`unexpected ${url}`));
}

const fakeDownload = vi.fn(async ({ dest, size, onProgress }) => {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, Buffer.alloc(size));
  onProgress(size);
  return dest;
});
const fakeExtract = vi.fn(async (_archive, destDir) => {
  await fsp.writeFile(path.join(destDir, 'llama-server.exe'), '');
});

function runtime(overrides = {}) {
  return createManagedRuntime({
    rootDir: root,
    models: MODELS,
    builds: BUILDS,
    platform: 'win32',
    detectHardware: async () => HARDWARE,
    download: fakeDownload,
    extractArchive: fakeExtract,
    spawnServer: fakeSpawn(),
    freePort: async () => ports.shift(),
    processAlive: (pid) => Object.keys(listening).length > 0 && pid > 0,
    killProcess: vi.fn((pid) => { for (const port of Object.keys(listening)) delete listening[port]; return pid; }),
    freeDiskBytes: async () => 100 * GB,
    fetchImpl: fakeFetch,
    sleep: async () => {},
    now: () => clock,
    setTimer: () => {},
    ...overrides,
  });
}

/**
 * Wait for the background setup to finish. By wall clock, not by tick count:
 * the fakes do real file I/O, and under a loaded parallel run a fixed number
 * of event-loop turns ran out first, failing the test and leaving the job
 * writing into a temp dir afterEach had already removed.
 */
async function settle(rt, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { job } = await rt.status();
    if (!job || !['engine', 'model', 'starting'].includes(job.phase)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('setup never settled');
}

const readState = () => JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-managed-'));
  clock = 1_000_000;
  ports = [41001, 41002, 41003];
  listening = {};
  busySlots = false;
  spawned = [];
  nextPid = 9000;
  fakeDownload.mockClear();
  fakeExtract.mockClear();
});
afterEach(() => fsp.rm(root, { recursive: true, force: true }));

describe('managed runtime: status before anything is installed', () => {
  it('reports the machine, the catalog priced against it, and nothing installed', async () => {
    const status = await runtime().status();
    expect(status).toMatchObject({
      supported: true,
      hardware: { gpu: 'GTX 1660 SUPER', vramBytes: 6 * GB },
      engine: { build: 'win32-x64-cuda12', label: 'NVIDIA CUDA 12', installed: false },
      recommendedId: 'small',
      activeModelId: null,
      server: null,
      job: null,
    });
    expect(status.models.map((m) => [m.id, m.fit, m.downloaded])).toEqual([['tiny', 'gpu', false], ['small', 'gpu', false], ['huge', 'too_big', false]]);
  });
});

describe('one-click setup', () => {
  it('installs the engine, downloads the recommended model, starts it and makes it active', async () => {
    const rt = runtime();
    const first = await rt.setup();
    expect(first).toMatchObject({ modelId: 'small', phase: 'engine', bytesTotal: 10 + 20 + 200 });
    const job = await settle(rt);
    expect(job).toMatchObject({ phase: 'ready', bytesDone: 230, error: null });

    expect(fakeDownload.mock.calls.map(([call]) => call.url)).toEqual(['https://gh.test/llama.zip', 'https://gh.test/cudart.zip', 'https://hf.test/small.gguf']);
    expect(fakeExtract).toHaveBeenCalledTimes(2);
    await expect(fsp.access(path.join(root, 'downloads', 'llama.zip'))).rejects.toThrow(); // archive removed after unpacking

    const [{ args }] = spawned;
    expect(args).toEqual(expect.arrayContaining(['--host', '127.0.0.1', '--alias', 'small', '--fit', 'on', '--fit-ctx', String(CONTEXT_FLOOR), '--no-webui']));
    // REGRESSION (measured): unbounded thinking used a whole 2048-token reply and answered nothing.
    expect(args[args.indexOf('--reasoning-budget') + 1]).toBe(String(REASONING_BUDGET_TOKENS));
    expect(args[args.indexOf('-m') + 1]).toBe(path.join(root, 'models', 'small.gguf'));

    const status = await rt.status();
    expect(status.server).toEqual({ port: 41001, modelId: 'small', baseURL: 'http://127.0.0.1:41001/v1' });
    expect(status.engine.installed).toBe(true);
    expect(status.activeModelId).toBe('small');
    expect(readState()).toEqual({ activeModelId: 'small', server: { pid: 9000, port: 41001, modelId: 'small' } });
  });

  it('a second click while it runs joins the same setup instead of starting another', async () => {
    const rt = runtime();
    await rt.setup();
    await rt.setup();
    await settle(rt);
    expect(fakeDownload).toHaveBeenCalledTimes(3);
    expect(spawned).toHaveLength(1);
  });

  it('a different model while one is being set up is refused, not raced', async () => {
    const rt = runtime();
    await rt.setup('small');
    await expect(rt.setup('tiny')).rejects.toMatchObject({ code: 'busy' });
    await settle(rt);
  });

  it('only catalog models, and only ones that fit', async () => {
    const rt = runtime();
    await expect(rt.setup('../../evil')).rejects.toMatchObject({ code: 'unknown_model' });
    await expect(rt.setup('huge')).rejects.toMatchObject({ code: 'too_big' });
    expect(fakeDownload).not.toHaveBeenCalled();
  });

  it('not enough disk: says so before downloading anything', async () => {
    const rt = runtime({ freeDiskBytes: async () => 0.5 * GB });
    await rt.setup();
    expect(await settle(rt)).toMatchObject({ phase: 'error', errorCode: 'disk_full' });
    expect(fakeDownload).not.toHaveBeenCalled();
  });

  it('a server that dies while loading reports why (its stderr), and nothing is left marked running', async () => {
    const rt = runtime({ spawnServer: fakeSpawn({ dieWhileLoading: true }) });
    await rt.setup();
    const job = await settle(rt);
    expect(job).toMatchObject({ phase: 'error', errorCode: 'server_exited' });
    expect(job.error).toContain('out of memory');
    expect((await rt.status()).server).toBeNull();
  });

  const hangingDownload = () => vi.fn(({ signal }) => new Promise((_resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort);
  }));

  it('cancel during a download stops it and keeps what was fetched for a resume', async () => {
    const download = hangingDownload();
    const rt = runtime({ download });
    await rt.setup();
    while (!download.mock.calls.length) await new Promise((resolve) => setImmediate(resolve));
    rt.cancel();
    const job = await settle(rt);
    expect(job).toMatchObject({ phase: 'cancelled', errorCode: 'cancelled' });
    expect(job.error).toMatch(/resumes/);
  });

  it('REGRESSION: cancel before the first download starts still cancels (no download is listening yet)', async () => {
    const download = hangingDownload();
    const rt = runtime({ download });
    await rt.setup();
    rt.cancel();
    expect(await settle(rt)).toMatchObject({ phase: 'cancelled' });
    expect(download).not.toHaveBeenCalled();
  });

  it('a hosted instance never downloads or runs anything', async () => {
    const rt = runtime({ hosted: () => true });
    await expect(rt.setup()).rejects.toMatchObject({ code: 'not_available_on_hosted' });
    expect((await rt.status()).supported).toBe(false);
    expect(fakeDownload).not.toHaveBeenCalled();
  });
});

describe('server lifecycle', () => {
  async function installed() {
    const rt = runtime();
    await rt.setup('small');
    await settle(rt);
    rt.stop();
    spawned = [];
    return rt;
  }

  it('starts on demand; concurrent requests share one start', async () => {
    const rt = await installed();
    const urls = await Promise.all([rt.ensureRunning(), rt.ensureRunning(), rt.ensureRunning()]);
    expect(new Set(urls)).toEqual(new Set(['http://127.0.0.1:41002/v1']));
    expect(spawned).toHaveLength(1);
  });

  it('stop kills the process and records that nothing runs', async () => {
    const rt = await installed();
    await rt.ensureRunning();
    rt.stop();
    expect(spawned[0].proc.kill).toHaveBeenCalled();
    expect(readState().server).toBeNull();
    expect(rt.baseURL()).toBeNull();
  });

  it('REGRESSION (Windows update kill): a server orphaned by a hard-killed backend is adopted, not duplicated', async () => {
    const before = await installed();
    await before.ensureRunning(); // pid 9001 on 41002; the backend then dies without stopping it
    const after = runtime(); // fresh process, same data dir
    expect(await after.ensureRunning()).toBe('http://127.0.0.1:41002/v1');
    expect(spawned).toHaveLength(1);
  });

  it('an orphan serving a different model is stopped and replaced', async () => {
    const before = await installed();
    await before.ensureRunning('tiny').catch(() => {}); // tiny not downloaded: refused
    await before.ensureRunning('small');
    const killProcess = vi.fn((pid) => { for (const port of Object.keys(listening)) delete listening[port]; return pid; });
    const after = runtime({ killProcess });
    await fakeDownload({ dest: path.join(root, 'models', 'tiny.gguf'), size: 100, onProgress: () => {} });
    await after.ensureRunning('tiny');
    expect(killProcess).toHaveBeenCalledWith(9001);
    expect(spawned.at(-1).args).toContain('tiny');
  });

  it('refuses a model that is not on disk instead of starting a server with no model', async () => {
    const rt = await installed();
    await expect(rt.ensureRunning('tiny')).rejects.toMatchObject({ code: 'not_installed' });
    expect(spawned).toHaveLength(0);
  });

  it('idle: stops after the quiet period, but never mid-generation', async () => {
    const rt = await installed();
    await rt.ensureRunning();
    clock += 31 * 60_000;
    busySlots = true;
    await rt.idleCheck();
    expect(rt.baseURL()).not.toBeNull();

    clock += 31 * 60_000;
    busySlots = false;
    await rt.idleCheck();
    expect(rt.baseURL()).toBeNull();
    expect(spawned[0].proc.kill).toHaveBeenCalled();
  });

  it('idle: recent use keeps it running', async () => {
    const rt = await installed();
    await rt.ensureRunning();
    clock += 10 * 60_000;
    await rt.idleCheck();
    expect(rt.baseURL()).not.toBeNull();
  });
});
