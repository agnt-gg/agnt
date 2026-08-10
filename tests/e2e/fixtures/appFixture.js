/**
 * The AGNT app, in a browser, without Electron.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The UI specs launched Electron. That is the shipping form of the app, but it
 * is not what the specs actually test: none of them assert anything about a
 * native window, a menu, IPC, or the updater. They click nav buttons and read
 * the DOM.
 *
 * Electron was therefore costing the suite its portability for nothing —
 * `_electron.launch` needs a built app, a binary, and a display, none of which
 * a bare CI runner has, which is why these specs could never be gated. And the
 * cost was real: ungated, all seven of them rotted into failing for months
 * without anyone noticing.
 *
 * Measured before writing this: frontend/src contains ZERO references to
 * `electronAPI`, and all 128 uses of `window.electron` are feature-detected
 * (`window.electron?.x`, `typeof window.electron !== 'undefined'`). The
 * backend already serves frontend/dist and has an SPA fallback for deep links.
 * So `node backend/server.js` + Chromium renders the same app — verified by
 * running it.
 *
 * WORKER-SCOPED, AND WHY THAT MATTERS
 * ───────────────────────────────────
 * Booting the backend runs the whole database pipeline (createTables, ~25
 * ALTER TABLE probes, FTS setup), which is ~10s. Per FILE that would be a
 * minute of CI for five files; per TEST it would be far worse. One backend per
 * worker amortises it, and each test still gets a fresh browser context, so
 * localStorage and route mocks never leak between tests.
 *
 * ISOLATION: AGNT_HOME points at a throwaway directory, so the specs cannot
 * touch a developer's real database — the same guarantee
 * tests/setup/isolate-data-dir.mjs gives the unit suites.
 */
import { test as base, expect } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { e2ePort, loginUser, signTestToken, TEST_JWT_SECRET } from './auth.js';

// tests/e2e/fixtures/ -> tests/e2e/ -> tests/ -> repo root
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

/** Start backend/server.js against a throwaway data directory. */
async function startBackend(port) {
  const distIndex = path.join(REPO, 'frontend', 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    throw new Error(
      'frontend/dist is missing, so the backend has no app to serve.\n'
      + 'Run: npm --prefix frontend run build',
    );
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-e2e-'));
  fs.mkdirSync(path.join(tmp, '.agnt', 'data'), { recursive: true });
  // A zero-byte agnt.db disarms the legacy-migration shim, which would
  // otherwise treat this as a fresh install and copy a real database in.
  fs.writeFileSync(path.join(tmp, '.agnt', 'data', 'agnt.db'), '');

  const log = [];
  const proc = spawn('node', [path.join(REPO, 'backend', 'server.js')], {
    cwd: REPO,
    env: {
      ...process.env,
      AGNT_HOME: tmp,
      USER_DATA_PATH: '',
      PORT: String(port),
      NODE_ENV: 'development',
      JWT_SECRET: TEST_JWT_SECRET,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (b) => { for (const l of b.toString().split('\n')) if (l.trim()) log.push(l); };
  proc.stdout.on('data', collect);
  proc.stderr.on('data', collect);

  const deadline = Date.now() + 180000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`backend exited early:\n${log.slice(-30).join('\n')}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`backend never became healthy:\n${log.slice(-30).join('\n')}`);
    await new Promise((r) => setTimeout(r, 250));
  }

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    log,
    stop: () => {
      try { proc.kill('SIGTERM'); } catch { /* already gone */ }
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
    },
  };
}

export const test = base.extend({
  /** One backend per worker. */
  agntBackend: [async ({}, use, workerInfo) => {
    const backend = await startBackend(e2ePort(workerInfo.workerIndex));
    try {
      await use(backend);
    } finally {
      backend.stop();
    }
  }, { scope: 'worker', timeout: 240000 }],

  /**
   * A signed-in page, NOT yet navigated.
   *
   * Deliberately not navigated: a spec that needs extra route mocks (agents,
   * workflows) must register them before the app boots, or the app fetches the
   * real empty list first and the mock arrives too late to matter.
   */
  appPage: async ({ browser, agntBackend }, use) => {
    const context = await browser.newContext({ baseURL: agntBackend.baseUrl });
    const page = await context.newPage();
    const consoleLogs = [];
    page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => consoleLogs.push(`[pageerror] ${e.message}`));
    page.__consoleLogs = consoleLogs;

    await loginUser(page, { token: signTestToken() });
    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
});

export { expect };

/**
 * Navigate and wait until the app shell is genuinely up.
 *
 * Waits on the sidebar rather than on a load event: `domcontentloaded` fires
 * long before Vue has mounted and verifySession has answered, and every one of
 * these specs immediately clicks something in that sidebar.
 *
 * `data-tour-id` is the selector of choice here, and not incidentally. The old
 * specs addressed `.primary-nav-button` / `.secondary-nav-button`, which
 * belonged to LeftPanel/header/Navigation.vue — a component CanvasScreen
 * replaced. Those selectors had been matching nothing for months, and because
 * nothing ran the specs, nothing said so. `data-tour-id` is a maintained
 * contract instead of a styling artefact: the guided-tour system addresses
 * these exact ids, so renaming one breaks a user-visible feature and gets
 * noticed. A test hook that something else depends on is a test hook that
 * stays true.
 */
export async function gotoApp(page, routePath = '/') {
  await page.goto(routePath, { waitUntil: 'domcontentloaded' });
  await expect(
    page.locator('[data-tour-id^="sidebar."]').first(),
    `app shell never rendered — the session is probably invalid. Console:\n${(page.__consoleLogs || []).slice(-25).join('\n')}`,
  ).toBeVisible({ timeout: 60000 });
}
