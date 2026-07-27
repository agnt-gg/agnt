/**
 * ROUTE SECURITY MANIFEST
 *
 * This test exists because the per-route fix is not the fix. In July 2026 an
 * audit found 57 API routes reachable with no credentials at all — including
 * `GET /api/local-file/<any-path>` (arbitrary file read, which yielded
 * JWT_SECRET from backend/.env and therefore token forgery) and
 * `POST /api/plugins/install` (remote code execution by design). Patching
 * those six routes would leave the *mechanism* intact: nothing stopped the
 * next route from landing unguarded, and nothing had stopped these.
 *
 * The mechanism was that `authenticateToken` reads like a guard and behaves
 * like a decorator — on a bad token it sets `isAuthenticated: false` and calls
 * next(). So this suite walks the REAL express routers and classifies every
 * registered route:
 *
 *   GUARDED — carries requireAuth() from utils/authGuard.js. Actually 401s.
 *   SOFT    — carries authenticateToken only. Reachable unauthenticated
 *             unless the handler re-checks. Tolerated for the existing
 *             surface; must never be used for a new sensitive route.
 *   OPEN    — no auth middleware whatsoever. Must be in PUBLIC_ROUTES with a
 *             written justification, or this test fails.
 *
 * Adding an unguarded route is now a build failure, not a discovery.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Routes that are intentionally reachable without credentials.
 * Every entry needs a reason. If you are adding one, ask whether the endpoint
 * can (a) read anything user-specific, (b) write anything, (c) spend money or
 * (d) execute code. If any answer is yes, it does not belong here.
 */
const PUBLIC_ROUTES = new Map([
  // --- liveness / boot-order ---
  ['AgentRoutes.js :: GET /health', 'Liveness probe. Returns a constant.'],
  ['ContentOutputRoutes.js :: GET /health', 'Liveness probe.'],
  ['CustomToolRoutes.js :: GET /health', 'Liveness probe.'],
  ['GoalRoutes.js :: GET /health', 'Liveness probe.'],
  ['UserRoutes.js :: GET /health', 'Liveness probe.'],
  ['OrchestratorRoutes.js :: GET /health', 'Liveness probe.'],
  ['StreamRoutes.js :: GET /health', 'Liveness probe.'],
  ['WorkflowRoutes.js :: GET /health', 'Liveness probe.'],
  ['SpeechRoutes.js :: GET /status', 'Whisper availability flag. No user data.'],
  ['SystemRoutes.js :: GET /status', 'RestartManager state/pid/uptime. Polled by the frontend during a restart and by the Electron supervisor.'],
  ['UserRoutes.js :: GET /token-status', 'THE auth-state probe: answers "am I logged in?". Must be callable without credentials or the app cannot boot to a login screen.'],
  ['AuthRoutes.js :: GET /connected', 'Local-first provider badge union. Soft user extraction; returns install-global env-sourced providers to any caller.'],

  // --- device pairing ---
  ['PairingRoutes.js :: POST /claim', 'The 128-bit single-use code IS the credential. Rate-limited to 10/min; codes expire in 120s and are consumed atomically.'],

  // --- public catalogues: vendor metadata and schema shapes, no user data ---
  ['PluginRoutes.js :: GET /marketplace', 'Public plugin catalogue mirror. Same data the marketplace website serves.'],
  ['PluginRoutes.js :: GET /installed', 'Installed plugin names/versions. No source, no secrets.'],
  ['PluginRoutes.js :: GET /installed/:name', 'Single plugin manifest metadata. No source, no secrets.'],
  ['PluginRoutes.js :: GET /tools', 'Plugin-contributed tool schemas. Rendered in the palette before auth settles.'],
  ['PluginRoutes.js :: GET /updates', 'Available plugin update versions. Read-only version numbers.'],
  ['ToolsRoutes.js :: GET /plugins-only', 'Plugin tool schemas for the workflow palette. Shapes only.'],
  ['ToolSchemaRoutes.js :: GET /schemas', 'Node-type catalogue for the workflow palette. Shapes only.'],
  ['ToolSchemaRoutes.js :: GET /schemas/:toolType', 'One node-type schema.'],
  ['ToolSchemaRoutes.js :: GET /schemas/category/:category', 'Node-type schemas by category.'],
  ['ToolSchemaRoutes.js :: GET /stats', 'Counts of registered node types.'],
  ['ToolSchemaRoutes.js :: GET /metadata/:toolType', 'Display metadata for one node type.'],
  ['ModelRoutes.js :: GET /:provider/models', 'Model catalogue for a provider. Public vendor metadata.'],
  ['ModelRoutes.js :: GET /models', 'Aggregate model catalogue. Public vendor metadata.'],
  ['ModelRoutes.js :: POST /models/refresh', 'Refresh the public model catalogue cache.'],
  ['ModelRoutes.js :: POST /:provider/models/refresh', 'Refresh one provider catalogue cache.'],
  ['ModelRoutes.js :: GET /models/categories', 'Static model taxonomy.'],
  ['ModelRoutes.js :: GET /schema-version', 'Hash of the model-metadata schema, for client cache invalidation.'],
  ['ModelRoutes.js :: GET /:provider/metadata', 'Context windows and pricing. Public vendor facts.'],
  ['ModelRoutes.js :: GET /:provider/metadata/:modelId', 'Context window and pricing for one model.'],
  ['ModelRoutes.js :: GET /provider-health', 'Provider reachability summary. No keys, no user data.'],
  ['ModelRoutes.js :: POST /provider-health/check', 'Trigger a provider reachability probe.'],
  ['CustomProviderRoutes.js :: GET /templates', 'Static starter templates for custom providers (Mistral, etc). Ships with the app.'],
  ['AdminClientVersionRoutes.js :: GET /client-versions', 'Upstream CLI version numbers read from public registries.'],
  ['AdminClientVersionRoutes.js :: POST /client-versions/refresh', 'Refresh that public version cache.'],
]);

/** Route modules to audit, mount path -> file. */
const ROUTE_FILES = fs
  .readdirSync(__dirname)
  .filter((f) => /Routes\.js$/.test(f))
  .sort();

const GUARD_NAMES = new Set(['requireAuthMiddleware']);
const SOFT_NAMES = new Set(['authenticateToken', 'bound authenticateToken']);

/**
 * Walk an express Router's layer stack and produce one record per route.
 * @param {import('express').Router} router
 * @param {string} file
 */
function describeRouter(router, file) {
  const out = [];
  const stack = router?.stack || [];

  // Router-level middleware (router.use(guard)) applies to every route below
  // it. LocalFileRoutes guards this way, so a route-local scan alone would
  // report it as OPEN and be wrong.
  const routerLevelGuards = new Set();
  for (const layer of stack) {
    if (layer.route) continue;
    const name = layer.handle?.name || '';
    if (GUARD_NAMES.has(name)) routerLevelGuards.add(name);
    if (SOFT_NAMES.has(name)) routerLevelGuards.add(name);
  }

  for (const layer of stack) {
    if (!layer.route) continue;
    const routePath = typeof layer.route.path === 'string' ? layer.route.path : String(layer.route.path);
    const methods = Object.keys(layer.route.methods || {}).filter((m) => m !== '_all');
    const handlerNames = (layer.route.stack || []).map((s) => s.handle?.name || '(anonymous)');
    const all = [...routerLevelGuards, ...handlerNames];

    const guarded = all.some((n) => GUARD_NAMES.has(n));
    const soft = all.some((n) => SOFT_NAMES.has(n));

    for (const method of methods) {
      out.push({
        file,
        route: `${method.toUpperCase()} ${routePath}`,
        // Keyed by file too: allow-listing `GET /stats` in one module must not
        // silently whitelist a future `GET /stats` somewhere else.
        key: `${file} :: ${method.toUpperCase()} ${routePath}`,
        tier: guarded ? 'GUARDED' : soft ? 'SOFT' : 'OPEN',
        handlerNames,
      });
    }
  }
  return out;
}

let ALL_ROUTES = [];
let LOAD_ERRORS = [];

beforeAll(async () => {
  for (const file of ROUTE_FILES) {
    try {
      const mod = await import(pathToFileURL(path.join(__dirname, file)).href);
      const router = mod.default;
      if (!router || typeof router !== 'function' || !Array.isArray(router.stack)) continue;
      ALL_ROUTES.push(...describeRouter(router, file));
    } catch (err) {
      LOAD_ERRORS.push(`${file}: ${err.message}`);
    }
  }
}, 120_000);

describe('route security manifest', () => {
  it('loads every route module', () => {
    expect(LOAD_ERRORS).toEqual([]);
    expect(ALL_ROUTES.length).toBeGreaterThan(100);
  });

  it('has no OPEN route outside the public allow-list', () => {
    const open = ALL_ROUTES.filter((r) => r.tier === 'OPEN');
    const undeclared = open.filter((r) => !PUBLIC_ROUTES.has(r.key));
    const report = undeclared.map((r) => `  '${r.key}',`).join('\n');
    expect(
      undeclared.length,
      `\n${undeclared.length} route(s) are reachable with NO authentication and are not in PUBLIC_ROUTES.\n` +
        `Either guard them with requireAuth() from utils/authGuard.js, or add them to PUBLIC_ROUTES with a justification.\n${report}\n`
    ).toBe(0);
  });

  it('keeps the public allow-list honest (no stale entries)', () => {
    const openKeys = new Set(ALL_ROUTES.filter((r) => r.tier === 'OPEN').map((r) => r.key));
    const stale = [...PUBLIC_ROUTES.keys()].filter((k) => !openKeys.has(k));
    expect(stale, `Stale PUBLIC_ROUTES entries (route is gone or now guarded): ${stale.join(', ')}`).toEqual([]);
  });

  // ------------------------------------------------------------------
  // The specific holes found in the July 2026 audit. Named individually so a
  // regression names itself instead of showing up as a count.
  // ------------------------------------------------------------------
  const MUST_BE_GUARDED = [
    ['LocalFileRoutes.js', 'GET /', 'arbitrary local file read -> JWT_SECRET -> token forgery -> RCE'],
    ['PluginRoutes.js', 'POST /install', 'installs and executes third-party code'],
    ['PluginRoutes.js', 'POST /install-file', 'installs and executes uploaded code'],
    ['PluginRoutes.js', 'POST /install-github', 'installs and executes code from an arbitrary repo'],
    ['PluginRoutes.js', 'DELETE /:name', 'destroys installed plugins and their data'],
    ['PluginRoutes.js', 'POST /reload', 'restarts every plugin process'],
    ['PluginRoutes.js', 'POST /update/:name', 'pulls and executes new plugin code'],
    ['PluginRoutes.js', 'GET /inspect/:name', 'discloses plugin source and permission diff'],
    ['SpeechRoutes.js', 'POST /transcribe', "spends the user's Whisper credits"],
  ];

  it.each(MUST_BE_GUARDED)('%s %s is GUARDED (%s)', (file, route) => {
    const match = ALL_ROUTES.find((r) => r.file === file && r.route === route);
    expect(match, `route ${route} not found in ${file}`).toBeDefined();
    expect(match.tier).toBe('GUARDED');
  });

  it('reports the surface (informational)', () => {
    const counts = ALL_ROUTES.reduce((acc, r) => {
      acc[r.tier] = (acc[r.tier] || 0) + 1;
      return acc;
    }, {});
    // eslint-disable-next-line no-console
    console.log(
      `[routeSecurity] ${ALL_ROUTES.length} routes across ${ROUTE_FILES.length} modules — ` +
        `GUARDED=${counts.GUARDED || 0} SOFT=${counts.SOFT || 0} OPEN=${counts.OPEN || 0}`
    );
    expect(ALL_ROUTES.length).toBeGreaterThan(0);
  });
});
