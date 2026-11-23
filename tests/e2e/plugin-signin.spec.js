/**
 * A plugin's sign-in, connected and removed through the real Plugins screen,
 * in Studio and in Focused.
 *
 * The app runs against a throwaway data directory, and the test account
 * installs one test plugin with an API-key sign-in from a package file, the
 * way a user installs one. Unlike fixtures/appFixture.js, the backend is
 * started with USER_DATA_PATH set, because PluginManager falls back to the
 * real %APPDATA%/AGNT plugins directory when it is empty. The marketplace URL
 * points at a closed local port so first-run catalogue installs fail fast,
 * and UNPACKED_PATH points at an empty plugin-builds folder so the bundled
 * plugins (minutes of extraction and scanning) are not installed. The temp
 * folder is removed afterwards.
 */
import { test as base, expect } from '@playwright/test';
import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import tar from 'tar';
import { e2ePort, loginUser, signTestToken, TEST_JWT_SECRET } from './fixtures/auth.js';
import { ONION_STORAGE_KEY, UNLOCK_RULES } from '../../frontend/src/services/navigationOnion.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const PROVIDER_ID = 'e2e-fake-crm';
const PROVIDER_NAME = 'E2E Fake CRM';
const FAKE_KEY = `e2e-fake-key-${Date.now()}`;

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const isLocal = (url) => /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(url);

const PLUGIN_NAME = 'e2e-fake-crm-plugin';

/** One plugin, one API-key sign-in, one no-op tool (a manifest needs an asset), packed as the installer reads it. */
function packFakePlugin(workDir) {
  const sourceRoot = path.join(workDir, 'package-src');
  const dir = path.join(sourceRoot, PLUGIN_NAME);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify(
      {
        name: 'e2e-fake-crm-plugin',
        displayName: 'E2E Fake CRM plugin',
        version: '1.0.0',
        description: 'Test-only plugin: declares an API-key sign-in and one no-op tool.',
        tools: [
          {
            type: 'e2e-fake-crm-ping',
            name: 'Fake CRM ping',
            description: 'Does nothing.',
            category: 'action',
            entryPoint: 'ping.js',
            authProvider: PROVIDER_ID,
            parameters: {},
          },
        ],
        auth: [
          {
            id: PROVIDER_ID,
            name: PROVIDER_NAME,
            type: 'apikey',
            keyLabel: 'API token',
            instructions: 'Any value works here; nothing is called.',
          },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, 'ping.js'), 'export default async function execute() {\n  return { success: true };\n}\n');
  // One top-level folder: the installer strips it when extracting.
  const archive = path.join(workDir, `${PLUGIN_NAME}.tar.gz`);
  tar.c({ gzip: true, file: archive, cwd: sourceRoot, sync: true }, [PLUGIN_NAME]);
  return archive;
}

/** Install the packed plugin for the test account, through the route a user's package file takes. */
async function installFakePlugin(baseUrl, archive) {
  const r = await fetch(`${baseUrl}/api/plugins/install-file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${signTestToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: PLUGIN_NAME, fileName: path.basename(archive), fileData: fs.readFileSync(archive).toString('base64') }),
  });
  const result = await r.json().catch(() => ({}));
  if (!r.ok || !result.success) throw new Error(`installing the fake plugin failed (${r.status}): ${JSON.stringify(result).slice(0, 500)}`);
}

/** The AGNT cloud, as far as this harness needs it: it confirms a disconnect and answers nothing else. */
function startCloudStub() {
  const server = http.createServer((req, res) => {
    const confirmed = req.method === 'POST' && req.url.startsWith('/auth/disconnect/');
    res.writeHead(confirmed ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(confirmed ? { success: true } : { error: 'Not served by this harness' }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}

/** backend/server.js against a throwaway USER_DATA_PATH that holds the fake plugin. */
async function startBackend(port) {
  const distIndex = path.join(REPO, 'frontend', 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    throw new Error('frontend/dist is missing, so the backend has no app to serve.\nRun: npm --prefix frontend run build');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-e2e-plugin-'));
  fs.mkdirSync(path.join(tmp, 'Data'), { recursive: true });
  // A zero-byte agnt.db disarms the legacy-migration shim (see appFixture.js).
  fs.writeFileSync(path.join(tmp, 'Data', 'agnt.db'), '');
  const archive = packFakePlugin(tmp);
  // PluginInstaller reads bundled .agnt files from UNPACKED_PATH/backend/plugins/plugin-builds.
  const unpacked = path.join(tmp, 'unpacked');
  fs.mkdirSync(path.join(unpacked, 'backend', 'plugins', 'plugin-builds'), { recursive: true });

  const cloud = await startCloudStub();
  const log = [];
  const proc = spawn('node', [path.join(REPO, 'backend', 'server.js')], {
    cwd: REPO,
    env: {
      ...process.env,
      USER_DATA_PATH: tmp,
      AGNT_HOME: tmp,
      PORT: String(port),
      NODE_ENV: 'development',
      JWT_SECRET: TEST_JWT_SECRET,
      UNPACKED_PATH: unpacked,
      PLUGIN_MARKETPLACE_URL: 'http://127.0.0.1:9/unreachable',
      // Never the live service: the same cloud on every machine, CI included.
      REMOTE_URL: cloud.url,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collect = (b) => {
    for (const l of b.toString().split('\n')) if (l.trim()) log.push(l);
  };
  proc.stdout.on('data', collect);
  proc.stderr.on('data', collect);

  const deadline = Date.now() + 180000;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`backend exited early:\n${log.slice(-30).join('\n')}`);
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`backend never became healthy:\n${log.slice(-30).join('\n')}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  await installFakePlugin(`http://127.0.0.1:${port}`, archive);

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    log,
    stop: () => {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      cloud.close();
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    },
  };
}

/**
 * /api/health answers before the plugin system has finished its first-run
 * install (bundled plugins are extracted and validated after the server is
 * listening), so "healthy" is not "the fake plugin is loaded". Wait for the
 * sign-in itself to be declared.
 */
async function waitForPluginSignIn(baseUrl, { timeoutMs = 120000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    try {
      const r = await fetch(`${baseUrl}/api/providers/auth/plugins`, { headers: { Authorization: `Bearer ${signTestToken()}` } });
      last = await r.json();
      if (Array.isArray(last?.providers) && last.providers.some((p) => p.id === PROVIDER_ID)) return last;
    } catch (error) {
      last = { error: error.message };
    }
    if (Date.now() > deadline) throw new Error(`the fake plugin never declared its sign-in. Last answer: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** What the harness backend says is connected for the test account. */
async function connectedApps(baseUrl) {
  const r = await fetch(`${baseUrl}/api/auth/connected`, { headers: { Authorization: `Bearer ${signTestToken()}` } });
  expect(r.ok, `GET /api/auth/connected answered ${r.status}`).toBe(true);
  const list = await r.json();
  // The list holds strings or { provider_id | providerId | id } objects.
  return list
    .map((app) => (typeof app === 'string' ? app : app?.provider_id || app?.providerId || app?.id || ''))
    .map((id) => String(id).toLowerCase())
    .filter(Boolean);
}

const test = base.extend({
  agntBackend: [
    async ({}, use, workerInfo) => {
      // Off the shared e2e port range: this worker's backend is its own.
      const backend = await startBackend(e2ePort(workerInfo.workerIndex) + 50);
      try {
        await use(backend);
      } finally {
        backend.stop();
      }
    },
    { scope: 'worker', timeout: 240000 },
  ],

  /** 'studio' (the Terminal shell) or 'focused' (AGNT One). Both host the same Plugins page. */
  uiMode: ['studio', { option: true }],

  appPage: async ({ browser, agntBackend, uiMode }, use) => {
    const context = await browser.newContext({ baseURL: agntBackend.baseUrl });
    const earned = ['chat', ...UNLOCK_RULES.map((rule) => rule.id)];
    // Registered before loginUser's init script, which only sets uiMode when it is absent.
    await context.addInitScript(
      ({ key, ids, mode }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, unlocked: ids, seeded: ids, fresh: [] }));
        localStorage.setItem('uiMode', mode);
        localStorage.setItem('tours_auto_start', 'false');
      },
      { key: ONION_STORAGE_KEY, ids: earned, mode: uiMode },
    );
    const page = await context.newPage();
    const consoleLogs = [];
    page.on('console', (m) => consoleLogs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => consoleLogs.push(`[pageerror] ${e.message}`));
    page.__consoleLogs = consoleLogs;

    await loginUser(page, { token: signTestToken() });

    // loginUser mocks the connected-apps list. The harness backend's own
    // answer is the one under test, so only other addresses stay mocked.
    await page.unroute('**/auth/connected');
    await page.route(
      (url) => /\/auth\/connected$/.test(url.pathname) && !isLocal(url.href),
      (route) => route.fulfill(json([])),
    );

    try {
      await use(page);
    } finally {
      await context.close();
    }
  },
});

/**
 * Connect the fake sign-in with a key, then remove it, through the Apps page's
 * Connections list. Studio and AGNT One draw the same page; `surface` names the
 * shell's frame and the toast it reports results in.
 */
async function connectThenDisconnect(page, agntBackend, surface) {
  // Every sign-in request the page makes, by where it went.
  const remoteSignIns = [];
  const localSignIns = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!isLocal(url) && /\/auth\/(connect|apikeys|disconnect)\//.test(url)) remoteSignIns.push(`${request.method()} ${url}`);
    if (isLocal(url) && url.includes(`/providers/${PROVIDER_ID}/auth/`)) localSignIns.push(`${request.method()} ${new URL(url).pathname}`);
  });

  // The fake plugin loaded: the backend lists its sign-in, without complaint.
  const declared = await waitForPluginSignIn(agntBackend.baseUrl);
  expect(declared.problems.filter((p) => /e2e-fake/.test(p)), 'the fake manifest was refused').toEqual([]);
  expect(await connectedApps(agntBackend.baseUrl)).not.toContain(PROVIDER_ID);

  await page.goto('/connectors', { waitUntil: 'domcontentloaded' });
  await expect(page.locator(surface.shellMarker), `app shell never rendered. Console:\n${page.__consoleLogs.slice(-20).join('\n')}`).toBeAttached({ timeout: 60000 });

  // Connections is the page's first section: find the plugin's sign-in there.
  const page$ = page.locator('[data-testid="one-apps"]');
  await expect(page$.locator('[data-section="connections"] h1')).toHaveText('Connections', { timeout: 30000 });
  await page$.getByTestId('apps-search').fill(PROVIDER_NAME);
  const row = page$.locator(`.tr.body-row[data-row="${PROVIDER_ID}"]`);
  await expect(row, 'the plugin sign-in is not offered on the Apps page').toBeVisible({ timeout: 30000 });
  await expect(row).toContainText('Plugin sign-in');
  await expect(row).toContainText('Not connected');
  // Its details, where both shells offer Connect (Studio's status cell shows state only).
  await row.locator('.name').click();
  // AppsDrawer is teleported to <body>, outside the page.
  const drawer = page.getByTestId('apps-drawer').getByRole('dialog', { name: PROVIDER_NAME });
  await drawer.locator('[data-section="status"] button[data-action="signin"]').click();

  // The key prompt: its own title, the plugin's key label and a password field.
  const dialog = page.locator('.modal-content');
  await expect(dialog.locator('h3')).toHaveText(`Connect ${PROVIDER_NAME}`);
  await expect(dialog.locator('.modal-message')).toContainText('API token');
  const input = dialog.locator('input');
  await expect(input).toHaveAttribute('type', 'password');
  await input.fill(FAKE_KEY);
  await dialog.locator('.modal-actions button', { hasText: 'Connect' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(surface.toast)).toHaveText(`${PROVIDER_NAME} is connected.`, { timeout: 30000 });

  // The harness backend lists it.
  expect(await connectedApps(agntBackend.baseUrl)).toContain(PROVIDER_ID);
  expect(localSignIns).toContain(`POST /api/providers/${PROVIDER_ID}/auth/connect`);
  expect(remoteSignIns).toEqual([]);

  if (process.env.AGNT_E2E_DIAG) {
    // What the store believes, before and after a forced re-fetch of its own.
    const readStore = () => page.evaluate(() => {
      const store = document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store;
      return { connectedApps: store?.state.appAuth?.connectedApps, providers: (store?.state.appAuth?.allProviders || []).filter((p) => p.pluginProvided).map((p) => `${p.id}:${p.connected}`) };
    });
    console.log(`[plugin-signin][diag] store after Connected dialog: ${JSON.stringify(await readStore())}`);
    await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('appAuth/fetchConnectedApps', { forceRefresh: true }));
    console.log(`[plugin-signin][diag] store after a forced fetchConnectedApps: ${JSON.stringify(await readStore())}`);
  }

  // The page agrees: its details and its row, now connected.
  const shownAt = Date.now();
  await expect(drawer.locator('[data-section="status"] strong')).toHaveText('Connected', { timeout: Number(process.env.AGNT_E2E_ACCOUNT_ROW_TIMEOUT_MS || 30000) });
  console.log(`[plugin-signin] ${surface.name}: showed Connected ${Date.now() - shownAt} ms after the connect was confirmed`);
  await expect(row.locator('.st')).toContainText('Connected');

  // Remove the key from the same details.
  await drawer.locator('button[data-action="disconnect"]').click();
  await expect(dialog.locator('h3')).toHaveText(`Disconnect ${PROVIDER_NAME}?`);
  await dialog.locator('.modal-actions button', { hasText: 'Disconnect' }).click();
  await expect(page.locator(surface.toast)).toHaveText(`${PROVIDER_NAME} disconnected.`, { timeout: 30000 });

  expect(await connectedApps(agntBackend.baseUrl)).not.toContain(PROVIDER_ID);
  expect(localSignIns).toContain(`POST /api/providers/${PROVIDER_ID}/auth/disconnect`);
  expect(remoteSignIns).toEqual([]);
}

const STUDIO = { name: 'Studio', shellMarker: '[data-testid="studio-apps"]', toast: '.studio-apps-toast' };
const FOCUSED = { name: 'Focused', shellMarker: '.ui-one [data-testid="one-apps"]', toast: '.focused-toast' };

test.describe("a plugin's own sign-in", () => {
  test.setTimeout(150000);

  test.describe('in Studio', () => {
    test('connects with a key and disconnects again from the Plugins screen @ci', async ({ appPage: page, agntBackend }) => {
      await connectThenDisconnect(page, agntBackend, STUDIO);
    });
  });

  test.describe('in Focused', () => {
    test.use({ uiMode: 'focused' });
    test('connects with a key and disconnects again from the Apps page @ci', async ({ appPage: page, agntBackend }) => {
      await connectThenDisconnect(page, agntBackend, FOCUSED);
    });
  });

  test.afterEach(async ({ appPage: page }, testInfo) => {
    if (testInfo.status === testInfo.expectedStatus) return;
    const shot = path.join(os.tmpdir(), `agnt-e2e-plugin-signin-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    testInfo.attachments.push({ name: 'screenshot', path: shot, contentType: 'image/png' });
    console.log(`[plugin-signin] failed; screenshot: ${shot}\n[plugin-signin] console:\n${(page.__consoleLogs || []).slice(-40).join('\n')}`);
  });
});
