/**
 * CONTRACT: an unauthenticated desktop route bounces to /settings, and only a
 * mobile lite route bounces to /m.
 *
 * WHY THIS EXISTS
 * ---------------
 * PR #54 added the lite shell and classified its routes with:
 *
 *     to.path.startsWith('/m')
 *
 * which is a PREFIX test standing in for a SEGMENT test. It is true for every
 * route whose name merely begins with the letter m, so /marketplace and /memory
 * both classified as mobile lite: a desktop session that lapsed on either page
 * was redirected to the phone pairing screen.
 *
 * The change shipped with green CI on both sides. authGuard.spec.js gained
 * assertions for the new /m routes, and nothing anywhere asserted where the
 * OTHER twenty-odd routes go. A new spec described the new behaviour; no spec
 * described the invariant that broke.
 *
 * So this test does not check `/marketplace` — checking the two routes that
 * happened to break is how you get a guard that misses the third. It enumerates
 * the REAL route table from router/index.js and asserts the classification for
 * every declared path, so any future route (/mail, /models, /metrics...) is
 * covered the day it is added.
 *
 * NOTE ON COMMENT STRIPPING: router/index.js contains commented-out route
 * blocks (an old /marketplace and /execution/:id). A naive regex over the raw
 * source sees 32 paths where only 30 are live, and would eventually assert
 * against a route that does not exist. Comments are stripped before parsing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthGuard, isLiteRoute } from './authGuard.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTER_SRC = path.join(HERE, 'index.js');

/** Live `path:` values from router/index.js, with comments removed first. */
function declaredRoutePaths() {
  const raw = fs.readFileSync(ROUTER_SRC, 'utf8');
  const noBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const live = noBlockComments
    .split(/\r?\n/)
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  return [...live.matchAll(/path:\s*'([^']+)'/g)]
    .map((m) => m[1])
    .filter((p) => p.startsWith('/'));
}

function makeStore() {
  return {
    state: {
      userAuth: {
        token: 'a-token',
        user: null,
        lastAuthFailure: { reason: 'http_401', status: 401, timestamp: Date.now() },
      },
    },
    getters: { 'userAuth/isAuthenticated': false },
    dispatch: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn(),
  };
}

/** Where does an unauthenticated navigation to `routePath` land? */
async function bounceTargetFor(routePath, meta = {}) {
  const guard = createAuthGuard(makeStore());
  let landed = null;
  const next = (arg) => {
    landed = arg && typeof arg === 'object' && arg.path ? arg.path : '(allowed)';
  };
  await guard(
    { path: routePath, fullPath: routePath, query: {}, meta: { requiresAuth: true, ...meta } },
    { path: '/' },
    next
  );
  return landed;
}

describe('route bounce classification (desktop vs mobile lite)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    if (typeof window !== 'undefined' && !window.dispatchEvent) window.dispatchEvent = () => {};
  });
  afterEach(() => vi.restoreAllMocks());

  it('finds a real route table to assert against', () => {
    // Anti-vacuity. A parser that silently matches nothing would make every
    // assertion below pass while checking exactly zero routes.
    const paths = declaredRoutePaths();
    expect(paths.length).toBeGreaterThan(20);
    expect(paths).toContain('/m');
    expect(paths).toContain('/settings');
  });

  it('strips commented-out route blocks before parsing', () => {
    const raw = fs.readFileSync(ROUTER_SRC, 'utf8');
    const rawCount = [...raw.matchAll(/path:\s*'\/[^']*'/g)].length;
    const liveCount = declaredRoutePaths().length;
    // If this ever goes equal, the commented blocks were deleted -- fine, but
    // then the stripping is untested, so make that visible rather than silent.
    expect(liveCount).toBeLessThanOrEqual(rawCount);
    expect(liveCount).toBeGreaterThan(0);
  });

  it('bounces EVERY non-lite declared route to /settings', async () => {
    const offenders = [];
    for (const routePath of [...new Set(declaredRoutePaths())]) {
      if (isLiteRoute({ path: routePath })) continue;
      const landed = await bounceTargetFor(routePath);
      if (landed !== '/settings') offenders.push(`${routePath} -> ${landed}`);
    }
    expect(offenders).toEqual([]);
  });

  it('bounces every lite route to /m', async () => {
    const liteRoutes = declaredRoutePaths().filter((p) => isLiteRoute({ path: p }));
    expect(liteRoutes.length).toBeGreaterThan(0); // anti-vacuity
    for (const routePath of liteRoutes) {
      expect(await bounceTargetFor(routePath)).toBe('/m');
    }
  });

  it('honours meta.lite for a route whose path is not under /m', async () => {
    expect(await bounceTargetFor('/somewhere-else', { lite: true })).toBe('/m');
  });

  describe('isLiteRoute — the segment rule itself', () => {
    it.each([
      ['/m', true],
      ['/m/pair', true],
      ['/m/chat', true],
      ['/m/deeply/nested', true],
      ['/marketplace', false],
      ['/memory', false],
      ['/models', false],
      ['/metrics', false],
      ['/mail', false],
      ['/m-something', false],
      ['/settings', false],
      ['/', false],
    ])('%s -> lite:%s', (routePath, expected) => {
      expect(isLiteRoute({ path: routePath })).toBe(expected);
    });

    it('tolerates a malformed route object', () => {
      expect(isLiteRoute(undefined)).toBe(false);
      expect(isLiteRoute({})).toBe(false);
      expect(isLiteRoute({ path: undefined })).toBe(false);
    });
  });
});
