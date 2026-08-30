/**
 * Servers and tabs for tests/e2e/cross-client-runs.spec.js.
 *
 * Kept out of the spec so the spec reads as assertions rather than as
 * orchestration, and named without `.spec`/`.test` so Playwright's discovery
 * does not mistake it for a suite.
 *
 * Two servers are needed and neither can be the app's own:
 *
 *   1. A throwaway BACKEND (crossClientBackend.mjs) — spawned as a child
 *      process, not imported, because it rewrites AGNT_HOME and pulls in the
 *      whole database stack. Doing that inside a Playwright worker would
 *      contaminate the worker's module registry and environment.
 *
 *   2. A Vite dev server for frontend/_harness/crossclient.html — the harness
 *      page imports real frontend modules that need the '@' alias, .vue
 *      resolution and bare-module resolution, so a bundler is not optional.
 *      Created programmatically rather than from a config file, because the
 *      proxy target depends on a port that is chosen per worker at run time.
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// tests/e2e/fixtures/ -> tests/e2e/ -> tests/ -> repo root
export const REPO = path.resolve(HERE, '../../..');
const FRONTEND = path.join(REPO, 'frontend');

/**
 * Ports, derived from the Playwright worker index.
 *
 * Worker-indexed rather than fixed, following tests/e2e/app.spec.js, so two
 * workers can never collide on a bind.
 *
 * 5199 IS A SAFETY CONSTANT, NOT A PREFERENCE. frontend/user.config.js resolves
 * the backend as:
 *
 *   const isDevServer = window.location.port === '5173';
 *   backendBaseUrl = isDevServer ? 'http://localhost:3333/api'
 *                                : `${window.location.origin}/api`;
 *
 * So a harness served on 5173 would send every request to whatever real AGNT
 * install is listening on 3333 — a developer's own, with their own database.
 * On any other port the page talks to its own origin, which the proxy below
 * sends to the throwaway backend. assertSafePorts() enforces this, and the spec
 * additionally asserts the URL the page actually resolved.
 */
export function portsForWorker(workerIndex = 0) {
  return {
    backend: 39717 + workerIndex,
    vite: 5199 + workerIndex,
  };
}

export function assertSafePorts({ vite }) {
  if (vite === 5173) {
    throw new Error('ABORT: harness port 5173 would point the page at a real AGNT backend on :3333');
  }
}

/** Spawn the harness backend and resolve once it is genuinely listening. */
export async function startHarnessBackend(port, { timeout = 120000 } = {}) {
  const log = [];
  const proc = spawn('node', [path.join(HERE, 'crossClientBackend.mjs'), String(port)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (b) => {
    for (const line of b.toString().split('\n')) if (line.trim()) log.push(line);
  };
  proc.stdout.on('data', collect);
  proc.stderr.on('data', collect);

  const deadline = Date.now() + timeout;
  for (;;) {
    if (log.some((l) => l.startsWith('HARNESS_READY'))) break;
    const err = log.find((l) => l.startsWith('HARNESS_ERROR'));
    if (err) throw new Error(`harness backend failed: ${err}\n${log.join('\n')}`);
    if (proc.exitCode !== null) throw new Error(`harness backend exited early:\n${log.join('\n')}`);
    if (Date.now() > deadline) throw new Error(`harness backend did not start:\n${log.join('\n')}`);
    await new Promise((r) => setTimeout(r, 100));
  }

  const field = (name) => (log.find((l) => l.startsWith(name)) || '').split(' ')[1];
  return {
    proc,
    log,
    token: field('HARNESS_TOKEN'),
    tmpDir: field('HARNESS_TMP'),
    /** Lines matching a needle — how the "(N clients)" assertions read the log. */
    lines: (needle) => log.filter((l) => l.includes(needle)),
    stop: () => { try { proc.kill('SIGTERM'); } catch { /* already gone */ } },
  };
}

/** Start a Vite dev server for the harness page, proxying to the backend. */
export async function startHarnessVite(vitePort, backendPort) {
  // Imported from the frontend's own node_modules: vite is a frontend
  // dependency, and this file runs from the repo root under Playwright.
  //
  // AS A file:// URL, NOT AS A PATH. `import()` takes a URL, and on Windows an
  // absolute path begins with a drive letter that the ESM loader reads as a
  // scheme:
  //
  //   ERR_UNSUPPORTED_ESM_URL_SCHEME: Only URLs with a scheme in: file, data,
  //   and node are supported... Received protocol 'c:'
  //
  // On Linux the same string is a valid POSIX path and resolves, so CI is green
  // and only Windows sees this — it failed cross-client-runs.spec.js outright
  // and took the five tests after it down as "did not run".
  const fromFrontend = (rel) => import(pathToFileURL(path.join(FRONTEND, rel)).href);
  const { createServer } = await fromFrontend('node_modules/vite/dist/node/index.js');
  const vue = (await fromFrontend('node_modules/@vitejs/plugin-vue/dist/index.mjs')).default;

  const target = `http://127.0.0.1:${backendPort}`;
  const server = await createServer({
    configFile: false,
    root: path.join(FRONTEND, '_harness'),
    plugins: [vue({ template: { compilerOptions: { isCustomElement: (t) => t.includes('-') || t === 'webview' } } })],
    resolve: { alias: { '@': path.join(FRONTEND, 'src') } },
    server: {
      // Bound explicitly to 127.0.0.1. Left to its default, Vite binds
      // "localhost", which resolves to ::1 on some machines while Playwright
      // dials IPv4 — an ERR_CONNECTION_REFUSED that looks like a broken test
      // and is really a broken address.
      host: '127.0.0.1',
      port: vitePort,
      strictPort: true,
      // The alias points outside the Vite root, so the parent must be allowed.
      fs: { allow: [FRONTEND, REPO] },
      proxy: {
        '/api': { target, changeOrigin: true },
        '/socket.io': { target, ws: true, changeOrigin: true },
      },
    },
    // The harness page is not the app; its logs are noise in a CI transcript.
    logLevel: 'error',
    optimizeDeps: { force: true },
  });
  await server.listen();
  return {
    server,
    url: `http://127.0.0.1:${vitePort}/crossclient.html`,
    stop: () => server.close(),
  };
}

/**
 * Open one TAB in an existing context and wait until it is genuinely ready —
 * harness mounted AND socket authenticated. Waiting on facts, never on sleeps:
 * a gate that races the socket fails at random, and a gate that fails at random
 * teaches people to ignore it.
 */
export async function openTab(context, url, { timeout = 60000 } = {}) {
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push(`PAGEERROR ${e.message}`));

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const deadline = Date.now() + timeout;
  for (;;) {
    const ready = await page.evaluate(() => !!window.__agntHarness?.socketAuthenticated).catch(() => false);
    if (ready) break;
    if (Date.now() > deadline) {
      throw new Error(`tab never authenticated its socket. Console:\n${logs.join('\n')}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const clientId = await page.evaluate(() => window.__agntHarness.clientId);
  const baseUrl = await page.evaluate(() => window.__agntHarness.baseUrl);
  return {
    page,
    logs,
    clientId,
    baseUrl,
    startRun: (id) => page.evaluate((c) => window.__agntHarness.startRun(c), id),
    snapshot: (id) => page.evaluate((c) => window.__agntHarness.snapshot(c), id),
    bootResume: () => page.evaluate(() => window.__agntHarness.bootResumeResult),
  };
}
