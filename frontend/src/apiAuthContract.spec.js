/**
 * CONTRACT: a frontend fetch() to a guarded backend route must carry the token.
 *
 * WHY THIS EXISTS
 * ---------------
 * `authenticateToken` used to let an unauthenticated request through with
 * `req.user = { isAuthenticated: false }`. A fetch() that forgot the
 * Authorization header therefore still "worked", so forgetting it was free and
 * silent. When those routes were hardened to actually return 401, eleven call
 * sites turned into hard failures at once — the entire plugin lifecycle
 * (install, uninstall, update, inspect, update-settings, update-policy) plus
 * voice transcription. The user-visible symptom was a single confusing string:
 * "Update failed: Authentication required".
 *
 * It was a *class* of bug rather than one mistake because no single module
 * owned the rule: getAuthHeaders() had been copy-pasted into seven files, so
 * every new fetch either duplicated it or forgot it.
 *
 * This test derives the guarded route set from the REAL backend route table
 * (server.js mount prefixes + each route module's guards) rather than from a
 * hand-maintained list, so it cannot drift as routes are added or hardened.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = HERE;
const REPO_ROOT = path.resolve(HERE, '../..');
const BACKEND = path.join(REPO_ROOT, 'backend');
const ROUTES_DIR = path.join(BACKEND, 'src/routes');

/**
 * Call sites that are unauthenticated ON PURPOSE. Every entry needs a reason.
 * A stale-entry check below fails if one stops being a violation, so this
 * cannot quietly accumulate dead exceptions.
 */
const INTENTIONALLY_ANONYMOUS = [
  // e.g. { file: 'views/Foo.vue', line: 12, reason: 'pre-login bootstrap' }
];

// ---------------------------------------------------------------------------
// 1. The real guarded route table
// ---------------------------------------------------------------------------
function readMountTable() {
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  const mounts = [...server.matchAll(/app\.use\('(\/api\/[^']+)',\s*(\w+)\)/g)].map((m) => ({
    prefix: m[1],
    module: m[2],
  }));
  const imports = {};
  for (const m of server.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]*routes\/[^'"]+)['"]/gi)) {
    imports[m[1]] = path.basename(m[2]);
  }
  // Longest prefix first: /api/skills/discovered must beat /api/skills.
  return mounts
    .map((m) => ({ ...m, file: imports[m.module] }))
    .filter((m) => m.file)
    .sort((a, b) => b.prefix.length - a.prefix.length);
}

function readRouteTable(mounts) {
  const routes = [];
  for (const { prefix, file } of mounts) {
    let src;
    try {
      src = fs.readFileSync(path.join(ROUTES_DIR, file), 'utf8');
    } catch {
      continue;
    }
    // A router-level guard covers every route in the module.
    const routerGuard = /router\.use\(\s*(requireAuth\w*|authenticateToken)\b/.exec(src)?.[1] || null;
    for (const m of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*(['"`])([^'"`]*)\2\s*,?\s*([A-Za-z_$][\w$.]*)?/g)) {
      const perRoute = /requireAuth|authenticateToken/.test(m[4] || '') ? m[4] : null;
      const guard = routerGuard || perRoute;
      // authenticateTokenOptional is the explicit opt-in to anonymous access.
      routes.push({
        prefix,
        method: m[1].toUpperCase(),
        path: m[3],
        guard: guard && !/Optional/.test(guard) ? guard : null,
      });
    }
  }
  return routes;
}

const MOUNTS = readMountTable();
const ROUTES = readRouteTable(MOUNTS);

function matchRoute(method, url) {
  const mount = MOUNTS.find((m) => url.startsWith(m.prefix + '/') || url === m.prefix);
  if (!mount) return null;
  const rest = url.slice(mount.prefix.length) || '/';
  return (
    ROUTES.find(
      (r) =>
        r.prefix === mount.prefix &&
        r.method === method &&
        new RegExp('^' + r.path.replace(/:[^/]+/g, '[^/]+').replace(/\//g, '\\/') + '$').test(rest)
    ) || null
  );
}

// ---------------------------------------------------------------------------
// 2. Frontend call sites
// ---------------------------------------------------------------------------
function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // Another spec's fixture dir may vanish mid-walk.
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(vue|js)$/.test(entry.name) && !/\.spec\.js$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Helpers that attach the token by construction, wherever they are imported. */
const AUTH_HELPERS = new Set(['authHeaders', 'jsonAuthHeaders', 'apiFetch']);

/**
 * Source of the object literal starting at `openIdx`, brace-matched.
 * Returns '' when that position is not an object literal.
 */
function objectLiteralAt(text, openIdx) {
  if (text[openIdx] !== '{') return '';
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(openIdx, i + 1);
    }
  }
  return text.slice(openIdx); // unbalanced (window truncation) -- take the rest
}

/** Resolve whether a symbol in this file produces an Authorization header. */
function symbolProvidesAuth(source, name) {
  const bare = name.replace(/\(\)$/, '').trim();
  // Imported from the shared module: auth is guaranteed by that module's own
  // unit tests, and the definition is not in this file to grep for.
  if (AUTH_HELPERS.has(bare) && /from\s+['"][^'"]*utils\/apiFetch(\.js)?['"]/.test(source)) return true;
  const patterns = [
    new RegExp(`(?:const|let|var|function)\\s+${bare}\\b[\\s\\S]{0,800}`),
    new RegExp(`\\b${bare}\\s*=\\s*[\\s\\S]{0,800}`),
  ];
  return patterns.some((pattern) => {
    const found = pattern.exec(source);
    return found ? /Authorization/i.test(found[0]) : false;
  });
}

/**
 * Every `fetch(`${API_CONFIG.BASE_URL}…`)` in a source file, with a verdict on
 * whether it carries auth. Exported shape is what the assertions consume.
 */
export function findApiCalls(source, label = '<inline>') {
  const lines = source.split(/\r?\n/);
  const calls = [];

  for (let i = 0; i < lines.length; i++) {
    const hit = /(?:fetch|apiFetch)\(\s*`\$\{API_CONFIG\.BASE_URL\}([^`]*)`/.exec(lines[i]);
    if (!hit) continue;

    const usesApiFetch = /\bapiFetch\(/.test(lines[i]);
    const window = lines.slice(i, i + 20).join('\n');
    const method = /method:\s*['"](\w+)['"]/.exec(window)?.[1]?.toUpperCase() || 'GET';
    const url = '/api' + (hit[1].split('?')[0].replace(/\$\{[^}]*\}/g, 'X').replace(/\/+$/, '') || '');

    let hasAuth = usesApiFetch; // apiFetch attaches the token by construction.
    if (!hasAuth) {
      const header = /headers:\s*([^,\n]+)/.exec(window);
      const identifiers = [];
      if (header) {
        // Take the leading identifier. Trailing call/close punctuation varies
        // (`getHeaders() });` on a single line), and a suffix-strip regex got
        // this wrong: it left `getHeaders(` and reported seven authenticated
        // filesystem calls as violations.
        //
        // Strip an opening brace and spread first. `headers: { ...authHeaders() }`
        // is a common shape, and without this the leading character is `{`, no
        // identifier is extracted, symbolProvidesAuth never runs, and a call
        // that DOES carry a token reads as unauthenticated. Harmless while the
        // route is unguarded -- it becomes a false violation the day it is
        // hardened, which is exactly when a guard must not cry wolf.
        const at = window.indexOf(header[0]);
        const valueStart = at + header[0].indexOf(header[1]);
        // Bound the search to the headers value itself. A fixed-width slice
        // bleeds into the NEXT call site in the same window, which would report
        // an unauthenticated call as authenticated because a later one nearby
        // happens to carry a token -- a false NEGATIVE, the only direction that
        // actually matters for a security guard.
        const scope =
          window[valueStart] === '{'
            ? objectLiteralAt(window, valueStart)
            : window.slice(at, at + 400);
        if (/Authorization/i.test(scope)) hasAuth = true;
        // `headers: getHeaders()` -- the value is a single expression.
        const headerExpr = header[1].trim().replace(/^\{\s*(?:\.\.\.)?/, '');
        const lead = /^([A-Za-z_$][\w$]*)/.exec(headerExpr)?.[1];
        if (lead) identifiers.push(lead);
        // `headers: { 'Content-Type': ..., ...authHeaders() }`, which commonly
        // spans several lines. The `[^,\n]+` capture above sees only `{`, so
        // every spread inside the literal is collected as a candidate.
        for (const m of scope.matchAll(/\.\.\.\s*([A-Za-z_$][\w$]*)/g)) identifiers.push(m[1]);
      } else if (/^\s*headers,?\s*$/m.test(window)) {
        // ES shorthand: `{ method, headers, body }`. Widespread in the chat
        // containers, and invisible to a `headers:` regex.
        identifiers.push('headers');
      }
      if (!hasAuth) hasAuth = identifiers.some((id) => symbolProvidesAuth(source, id));
    }

    calls.push({ file: label, line: i + 1, method, url, hasAuth });
  }
  return calls;
}

const ALL_CALLS = [];
for (const file of walk(FRONTEND_SRC)) {
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!source.includes('API_CONFIG.BASE_URL')) continue;
  const label = path.relative(FRONTEND_SRC, file).replace(/\\/g, '/');
  ALL_CALLS.push(...findApiCalls(source, label));
}

const VIOLATIONS = ALL_CALLS.filter((call) => {
  if (call.hasAuth) return false;
  const route = matchRoute(call.method, call.url);
  if (!route?.guard) return false;
  return !INTENTIONALLY_ANONYMOUS.some((entry) => entry.file === call.file && entry.line === call.line);
});

// ---------------------------------------------------------------------------
describe('frontend → backend auth contract', () => {
  it('sees a real backend route table (anti-vacuity)', () => {
    // Without this, a broken parser would find nothing and every assertion
    // below would pass by measuring an empty set.
    expect(fs.existsSync(path.join(BACKEND, 'server.js'))).toBe(true);
    expect(MOUNTS.length).toBeGreaterThan(30);
    expect(ROUTES.length).toBeGreaterThan(80);
    expect(ROUTES.filter((r) => r.guard).length).toBeGreaterThan(50);
  });

  it('sees a real set of frontend call sites (anti-vacuity)', () => {
    expect(ALL_CALLS.length).toBeGreaterThan(150);
    expect(ALL_CALLS.filter((c) => c.hasAuth).length).toBeGreaterThan(100);
  });

  it('no unauthenticated fetch() targets a guarded route', () => {
    const report = VIOLATIONS.map((v) => `  ${v.file}:${v.line}  ${v.method} ${v.url}`).join('\n');
    expect(
      VIOLATIONS,
      `These calls will fail with 401 "Authentication required".\n` +
        `Use apiFetch (or authHeaders) from @/utils/apiFetch.js:\n${report}\n`
    ).toEqual([]);
  });

  it('has no stale entries in the intentionally-anonymous allowlist', () => {
    // An exception that is no longer a violation is a lie in the codebase.
    const stale = INTENTIONALLY_ANONYMOUS.filter(
      (entry) => !ALL_CALLS.some((call) => call.file === entry.file && call.line === entry.line && !call.hasAuth)
    );
    expect(stale, `remove these from INTENTIONALLY_ANONYMOUS: ${JSON.stringify(stale)}`).toEqual([]);
  });

  it('every allowlist entry states a reason', () => {
    for (const entry of INTENTIONALLY_ANONYMOUS) expect(entry.reason?.length ?? 0).toBeGreaterThan(10);
  });

  describe('the detector itself', () => {
    // A guard that cannot fail is decoration. These reproduce the real bug and
    // the real fix inline, so the detector is proven on both sides.
    it('flags the exact shape that broke plugin updates', () => {
      const bug = [
        'const resp = await fetch(`${API_CONFIG.BASE_URL}/plugins/update/${name}`, {',
        "  method: 'POST',",
        "  headers: { 'Content-Type': 'application/json' },",
        '  body: JSON.stringify({ acceptedPermissions }),',
        '});',
      ].join('\n');
      const [call] = findApiCalls(bug);
      expect(call.hasAuth).toBe(false);
      expect(matchRoute(call.method, call.url)?.guard).toBeTruthy();
    });

    it('sees auth through a single-line spread: headers: { ...authHeaders() }', () => {
      // The identifier extraction takes the LEADING identifier of the header
      // expression, and a spread starts with `{` -- so no identifier was found,
      // symbolProvidesAuth never ran, and an authenticated call read as
      // unauthenticated. Silent while the route is unguarded; a false violation
      // the day it is hardened, which is when a guard must not cry wolf.
      const src = [
        "const authHeaders = () => ({ Authorization: `Bearer ${t}` });",
        'const res = await fetch(`${API_CONFIG.BASE_URL}/content-outputs`, {',
        '  headers: { ...authHeaders() },',
        '});',
      ].join('\n');
      expect(findApiCalls(src)[0].hasAuth).toBe(true);
    });

    it('sees auth through a MULTI-LINE header object', () => {
      // `headers:` captures to end of line, so a multi-line literal yields only
      // `{`. The whole brace-matched literal has to be searched.
      const src = [
        "const authHeaders = () => ({ Authorization: `Bearer ${t}` });",
        'const res = await fetch(`${API_CONFIG.BASE_URL}/content-outputs/save`, {',
        "  method: 'POST',",
        '  headers: {',
        "    'Content-Type': 'application/json',",
        '    ...authHeaders(),',
        '  },',
        '  body: JSON.stringify(body),',
        '});',
      ].join('\n');
      const [call] = findApiCalls(src);
      expect(call.method).toBe('POST');
      expect(call.hasAuth).toBe(true);
    });

    it('does NOT credit a call with a token that belongs to a later call', () => {
      // The scan used to take a fixed 400-character slice, which runs past the
      // end of one call and into the next. Crediting call A with call B's token
      // is a false negative -- the direction that actually lets a bug through.
      const src = [
        "const authHeaders = () => ({ Authorization: `Bearer ${t}` });",
        'const a = await fetch(`${API_CONFIG.BASE_URL}/plugins/install`, {',
        "  method: 'POST',",
        "  headers: { 'Content-Type': 'application/json' },",
        '});',
        'const b = await fetch(`${API_CONFIG.BASE_URL}/plugins/list`, {',
        '  headers: { ...authHeaders() },',
        '});',
      ].join('\n');
      const calls = findApiCalls(src);
      expect(calls).toHaveLength(2);
      expect(calls[0].hasAuth).toBe(false); // must NOT borrow from calls[1]
      expect(calls[1].hasAuth).toBe(true);
    });

    it('still flags a spread of something that provides no auth', () => {
      const src = [
        "const baseHeaders = () => ({ 'X-Trace': '1' });",
        'const res = await fetch(`${API_CONFIG.BASE_URL}/content-outputs`, {',
        '  headers: { ...baseHeaders() },',
        '});',
      ].join('\n');
      expect(findApiCalls(src)[0].hasAuth).toBe(false);
    });

    it('accepts the apiFetch fix', () => {
      const fixed = [
        'const resp = await apiFetch(`${API_CONFIG.BASE_URL}/plugins/update/${name}`, {',
        "  method: 'POST',",
        '  body: JSON.stringify({ acceptedPermissions }),',
        '});',
      ].join('\n');
      expect(findApiCalls(fixed)[0].hasAuth).toBe(true);
    });

    it('accepts an inline Authorization header', () => {
      const inline = [
        'await fetch(`${API_CONFIG.BASE_URL}/plugins/install`, {',
        "  method: 'POST',",
        '  headers: { Authorization: `Bearer ${token}` },',
        '});',
      ].join('\n');
      expect(findApiCalls(inline)[0].hasAuth).toBe(true);
    });

    it('accepts a headers variable built above the call (shorthand)', () => {
      // This pattern is widespread and must not be reported as a violation.
      const viaVariable = [
        "const headers = { 'Content-Type': 'application/json' };",
        "if (token) headers['Authorization'] = `Bearer ${token}`;",
        'await fetch(`${API_CONFIG.BASE_URL}/orchestrator/chat`, {',
        "  method: 'POST',",
        '  headers,',
        '});',
      ].join('\n');
      expect(findApiCalls(viaVariable)[0].hasAuth).toBe(true);
    });

    it('accepts an explicit `headers: headers` variable reference', () => {
      const explicit = [
        "const headers = { Authorization: `Bearer ${token}` };",
        'await fetch(`${API_CONFIG.BASE_URL}/orchestrator/chat`, {',
        "  method: 'POST',",
        '  headers: headers,',
        '});',
      ].join('\n');
      expect(findApiCalls(explicit)[0].hasAuth).toBe(true);
    });

    it('flags the shorthand form when the variable carries no auth', () => {
      // Shorthand must not become a blanket exemption.
      const decoy = [
        "const headers = { 'Content-Type': 'application/json' };",
        'await fetch(`${API_CONFIG.BASE_URL}/plugins/install`, {',
        "  method: 'POST',",
        '  headers,',
        '});',
      ].join('\n');
      expect(findApiCalls(decoy)[0].hasAuth).toBe(false);
    });

    it('accepts a locally-defined getHeaders() on the same line as the call', () => {
      // The single-line form that a suffix-strip regex mis-parsed.
      const oneLine = [
        'function getHeaders() {',
        "  const headers = { 'Content-Type': 'application/json' };",
        "  headers['Authorization'] = `Bearer ${token}`;",
        '  return headers;',
        '}',
        'const res = await fetch(`${API_CONFIG.BASE_URL}/filesystem/file`, { headers: getHeaders() });',
      ].join('\n');
      expect(findApiCalls(oneLine)[0].hasAuth).toBe(true);
    });

    it('accepts authHeaders() imported from the shared module', () => {
      // FormData uploads must not set Content-Type, so they use authHeaders()
      // rather than apiFetch. That has to read as authenticated.
      const imported = [
        "import { authHeaders } from '@/utils/apiFetch.js';",
        'await fetch(`${API_CONFIG.BASE_URL}/speech/transcribe`, {',
        "  method: 'POST',",
        '  headers: authHeaders(),',
        '  body: formData,',
        '});',
      ].join('\n');
      expect(findApiCalls(imported)[0].hasAuth).toBe(true);
    });

    it('still flags a bare helper that does NOT attach auth', () => {
      const decoy = [
        "function getHeaders() { return { 'Content-Type': 'application/json' }; }",
        'await fetch(`${API_CONFIG.BASE_URL}/plugins/install`, {',
        "  method: 'POST',",
        '  headers: getHeaders(),',
        '});',
      ].join('\n');
      expect(findApiCalls(decoy)[0].hasAuth).toBe(false);
    });

    it('accepts a shared getAuthHeaders() helper', () => {
      const viaHelper = [
        'function getAuthHeaders() {',
        "  const headers = { 'Content-Type': 'application/json' };",
        "  headers['Authorization'] = `Bearer ${localStorage.getItem('token')}`;",
        '  return headers;',
        '}',
        'await fetch(`${API_CONFIG.BASE_URL}/insights/stats`, { headers: getAuthHeaders() });',
      ].join('\n');
      expect(findApiCalls(viaHelper)[0].hasAuth).toBe(true);
    });

    it('resolves method and url correctly', () => {
      const sample = "await fetch(`${API_CONFIG.BASE_URL}/plugins/${name}`, { method: 'DELETE' });";
      const [call] = findApiCalls(sample);
      expect(call.method).toBe('DELETE');
      expect(call.url).toBe('/api/plugins/X');
    });
  });
});
