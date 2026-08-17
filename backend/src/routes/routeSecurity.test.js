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
 *   GUARDED — carries requireAuth() or authenticateToken. Actually 401s.
 *   SOFT    — carries authenticateTokenOptional: deliberately reachable
 *             unauthenticated, so the handler MUST re-check. Every one must be
 *             declared in ANONYMOUS_TOLERATED with a reason, or this fails.
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

  // --- OAuth redirect targets (no AGNT session exists on the inbound hop) ---
  ['MCPRoutes.js :: GET /oauth/callback', 'OAuth 2.1 redirect from a remote MCP provider. Arrives from the provider\'s domain in a plain browser hop that carries no AGNT session, so it cannot be token-guarded. The 192-bit CSPRNG `state` IS the credential: it is minted server-side per authorization, held in memory only, consumed atomically before validation (one attempt), expires in 10 minutes, and an unknown or stale value is refused before any token exchange. Same contract as PairingRoutes POST /claim.'],

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

// authenticateToken now returns 401 on a missing or invalid token, so it is a
// real guard. It used to sit in SOFT_NAMES: it read like a guard, behaved like
// a decorator, and 251 routes inherited that. See routes/Middleware.js.
const GUARD_NAMES = new Set([
  'requireAuthMiddleware',
  'authenticateToken',
  'bound authenticateToken',
  // The local LLM gateway carries its own credential scheme rather than the
  // session JWT, deliberately: it hands a token to a child process, so that
  // token must open one route and nothing else. It qualifies here for the only
  // reason that matters — it rejects. Loopback-only, and 401s on a token it did
  // not mint. See routes/LlmGatewayRoutes.js.
  'authenticateGateway',
]);

// The permissive behaviour still exists, but a route must now opt into it by
// name instead of receiving it silently.
const SOFT_NAMES = new Set(['authenticateTokenOptional', 'bound authenticateTokenOptional']);

/**
 * Routes deliberately served to anonymous callers via authenticateTokenOptional.
 * Same contract as PUBLIC_ROUTES: every entry needs a written reason, and the
 * handler must check req.user.isAuthenticated itself.
 */
const ANONYMOUS_TOLERATED = new Map([]);

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
    ['LlmGatewayRoutes.js', 'POST /v1/chat/completions', "spends the user's LLM credits as the user, from a child process"],
  ];

  it.each(MUST_BE_GUARDED)('%s %s is GUARDED (%s)', (file, route) => {
    const match = ALL_ROUTES.find((r) => r.file === file && r.route === route);
    expect(match, `route ${route} not found in ${file}`).toBeDefined();
    expect(match.tier).toBe('GUARDED');
  });

  // ------------------------------------------------------------------
  // THE SOFT TIER IS A GATE, NOT A STATISTIC.
  // ------------------------------------------------------------------
  // This suite used to COUNT soft routes and print the total in a test whose
  // only assertion was that the route list was non-empty. It observed 251 of
  // them and said nothing actionable — while an unauthenticated caller on the
  // LAN could read, write and delete the entire workspace through exactly
  // those routes. Measuring a hazard is not the same as failing on it.
  // ------------------------------------------------------------------
  it('has no route that tolerates anonymous callers outside the allow-list', () => {
    const soft = ALL_ROUTES.filter((r) => r.tier === 'SOFT');
    const undeclared = soft.filter((r) => !ANONYMOUS_TOLERATED.has(r.key));

    expect(
      undeclared.map((r) => r.key),
      'These routes let unauthenticated callers reach the handler. If that is ' +
        'deliberate, add them to ANONYMOUS_TOLERATED with a reason AND make the ' +
        'handler check req.user.isAuthenticated. Otherwise use authenticateToken:\n' +
        undeclared.map((r) => `  ${r.key}`).join('\n')
    ).toEqual([]);
  });

  it('keeps the anonymous allow-list honest (no stale entries)', () => {
    const softKeys = new Set(ALL_ROUTES.filter((r) => r.tier === 'SOFT').map((r) => r.key));
    const stale = [...ANONYMOUS_TOLERATED.keys()].filter((k) => !softKeys.has(k));
    expect(stale, `Stale ANONYMOUS_TOLERATED entries: ${stale.join(', ')}`).toEqual([]);
  });

  // ------------------------------------------------------------------
  // NO ROUTE MAY DERIVE IDENTITY FROM AN UNVERIFIED TOKEN.
  // ------------------------------------------------------------------
  // `jwt.decode` parses a token WITHOUT checking its signature, so any identity
  // taken from it is whatever the caller typed. CustomProviderRoutes had a
  // local `getUserIdFromToken` helper doing exactly that. It was not
  // exploitable — requireAuthHeader had already verified the same token and
  // applied the identical id/userId/user_id/sub extraction — but it is
  // indistinguishable at a glance from a real bypass, sitting in the directory
  // where such a helper is most likely to be copied.
  //
  // Until now the only thing watching this was an external audit scanner. That
  // scanner lives outside the repo, is not part of CI, and its anchor for this
  // property was about to be retired as "fixed" — which would have left the
  // property guarded by nothing at all. A guarantee worth having belongs in the
  // build, not in a tool someone remembers to run.
  //
  // TWO MODULES ARE DECLARED BELOW. They are TRACKED, NOT CLEARED — the
  // justification says what the residual risk is, not that there isn't one.
  // Both are pre-existing and both are currently masked by a larger problem:
  // while SHARED_JWT_SECRET is published, `jwt.verify` accepts a forged token
  // anyway, so the decode fallback adds nothing an attacker does not already
  // have. That stops being true the moment token-proof enforcement lands and
  // the shared secret is retired — at which point these become the residual
  // hole, and this list is where someone will find them.
  const JWT_DECODE_TOLERATED = new Map([
    [
      'AuthRoutes.js',
      'extractUserIdSoft: verify first, decode as a FALLBACK for remote-issued ' +
        'tokens. Soft by design — env-sourced providers are install-global and ' +
        'returned to anonymous callers. RESIDUAL: a forged token yields another ' +
        "user's CONNECTED-PROVIDER LIST (names only, no credentials). Re-evaluate " +
        'when the shared JWT secret is retired.',
    ],
    [
      'ModelRoutes.js',
      'Three sites decode to get a userId used to look up that user\'s stored ' +
        'provider key when listing models. RESIDUAL: higher than AuthRoutes — a ' +
        "forged token could exercise another user's key. Masked today by the " +
        'published shared secret. MUST be fixed before token-proof enforcement ' +
        'is flipped, or it becomes the way in.',
    ],
  ]);

  it('no route module extracts a user id from jwt.decode', async () => {
    const offenders = [];

    for (const file of ROUTE_FILES) {
      const source = await fs.promises.readFile(path.join(__dirname, file), 'utf8');
      // Strip comments: several files legitimately DOCUMENT this hazard.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (/jwt\s*\.\s*decode\s*\(/.test(code) && !JWT_DECODE_TOLERATED.has(file)) offenders.push(file);
    }

    expect(
      offenders,
      'These route modules call jwt.decode(). Read identity from `req.user`, ' +
        'populated by the guard the route already mounts — a decoded token is ' +
        'not evidence of anything. If a fallback is genuinely required, add the ' +
        'file to JWT_DECODE_TOLERATED with the residual risk spelled out:\n' +
        offenders.map((f) => `  ${f}`).join('\n')
    ).toEqual([]);
  });

  it('keeps the jwt.decode allow-list honest (no stale entries)', async () => {
    // A fixed file left on the list would quietly re-permit the pattern.
    const stale = [];
    for (const file of JWT_DECODE_TOLERATED.keys()) {
      const source = await fs.promises.readFile(path.join(__dirname, file), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      if (!/jwt\s*\.\s*decode\s*\(/.test(code)) stale.push(file);
    }
    expect(stale, `Fixed — remove from JWT_DECODE_TOLERATED: ${stale.join(', ')}`).toEqual([]);
  });

  it('anti-vacuity: that scan can see a jwt.decode that is really there', () => {
    // If the regex or the comment-stripping broke, the test above would pass
    // forever against an empty list.
    const reintroduced = 'const payload = jwt.decode(token);\nreturn payload?.id || payload?.sub;';
    const code = reintroduced.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(/jwt\s*\.\s*decode\s*\(/.test(code)).toBe(true);

    // ...and that a comment mentioning it does NOT trip the scan.
    const documented = '// never use jwt.decode(token) for identity';
    const strippedDoc = documented.replace(/^\s*\/\/.*$/gm, '');
    expect(/jwt\s*\.\s*decode\s*\(/.test(strippedDoc)).toBe(false);
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
