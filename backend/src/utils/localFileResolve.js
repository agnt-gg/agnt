/**
 * Stale-path recovery for `/api/local-file/*`.
 *
 * WHY THIS EXISTS
 * ───────────────
 * A chat message stores an absolute path SNAPSHOT, not a live reference. The
 * assistant renders `<img src="file:///…/agnt-social-card.png">` and that exact
 * string is persisted forever. Anything that later moves the file turns every
 * historical reference into a 404:
 *
 *   • a git worktree gets reaped after its branch lands (the common one — the
 *     path lived under `repos/agnt-server.wt/social-metadata/…`, which is
 *     temporary BY DESIGN),
 *   • a project directory is renamed or reorganised,
 *   • work moves between a worktree and the main checkout.
 *
 * The file is almost always still on disk, a couple of directory levels from
 * where the message says it is. Answering 404 is technically honest and
 * practically useless: the user sees "cannot find that image" for an image
 * they are looking at in another tab.
 *
 * WHAT IT DOES
 * ────────────
 * Three tiers, cheapest first, stopping at the first hit:
 *
 *   1. EXACT      — the path as written. Unchanged behaviour, zero overhead.
 *   2. WORKTREE   — pure string transforms of our own worktree conventions
 *                   (`<repo>.wt/<slug>/` and `<repo>/.worktrees/<slug>/`).
 *                   O(1), no directory reads, deterministic.
 *   3. ANCHORED   — walk down from the deepest ancestor that still EXISTS,
 *      SUFFIX       looking for a file whose trailing path segments match the
 *      SEARCH       requested one. Bounded hard (see the constants below).
 *
 * WHY TIER 3 IS SAFE TO GUESS WITH
 * ────────────────────────────────
 * It never matches on basename alone. A candidate must share at least
 * MIN_SUFFIX_SEGMENTS trailing segments with the requested path — `.../assets/
 * social/card.png`, not just `card.png` — and when several candidates match,
 * the longest suffix wins. That makes an accidental match require a genuine
 * duplicate of the same file laid out the same way, which is the case where
 * either answer is defensible anyway.
 *
 * The search is also SELF-SCOPING: it is anchored at an existing ancestor of
 * the path the caller already asked for, so it can never wander somewhere the
 * request did not already point at. It refuses to anchor at a filesystem root.
 *
 * SECURITY
 * ────────
 * A recovered path is a DIFFERENT path from the one that passed the gates, so
 * it is re-checked against both `isSecretPath` and `assertWithinRoots` before
 * it is ever returned. Recovery can only ever reach files the caller could
 * have requested directly.
 */

import fs from 'fs';
import path from 'path';
import { isSecretPath, assertWithinRoots } from './localFileScope.js';

/** Hard ceilings for the tier-3 walk, shared across every anchor it tries. */
const MAX_DIRS_VISITED = 2500;
const MAX_DEPTH = 8;
/** Refuse to anchor a search this close to the filesystem root. */
const MIN_ANCHOR_SEGMENTS = 2;
/**
 * How far ABOVE the deepest surviving directory the search may start.
 *
 * Anchoring only at the deepest survivor is too timid: when a file is
 * reorganised WITHIN a tree that still exists (`assets/img/hero.png` ->
 * `static/img/hero.png`), the old directory is still there, so the search
 * would begin inside it and never see the sibling it moved to. Lifting a few
 * levels covers that without opening the search up to the whole disk.
 */
const ANCHOR_LIFT_LEVELS = 3;
/** A candidate must share at least this many trailing segments (incl. basename). */
const MIN_SUFFIX_SEGMENTS = 2;

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 500;

/** Never descend into these — big, and never where an artifact lives. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.cache', '.turbo', 'target', 'vendor', 'bower_components',
  '__pycache__', '.venv', 'venv', '.terraform', '.gradle', 'Pods', '.idea',
]);

const caseFold = process.platform === 'win32';
const fold = (s) => (caseFold ? s.toLowerCase() : s);
const toPosix = (p) => String(p || '').replace(/\\/g, '/');

/** Resolution results, keyed by the requested path. Negatives cached too. */
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Cheap eviction: drop the oldest insertion. Map preserves insertion order.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

/** Test seam — the walk caches, and tests move files between assertions. */
export function clearResolveCache() {
  cache.clear();
}

function statKind(p) {
  try {
    const s = fs.statSync(p);
    if (s.isFile()) return 'file';
    if (s.isDirectory()) return 'dir';
    return 'other';
  } catch {
    return 'none';
  }
}

/** Path segments below the filesystem root: `C:/a/b` -> ['a','b']. */
function segmentsOf(posixPath) {
  return posixPath.split('/').filter((s) => s && !/^[a-zA-Z]:$/.test(s));
}

/** How many trailing segments two paths share, compared case-correctly. */
function commonSuffixLength(aSegs, bSegs) {
  let n = 0;
  while (n < aSegs.length && n < bSegs.length && fold(aSegs[aSegs.length - 1 - n]) === fold(bSegs[bSegs.length - 1 - n])) {
    n += 1;
  }
  return n;
}

/**
 * Tier 2 — our own worktree layouts, undone by string surgery.
 * `npm run wt` produces both shapes; neither survives `wt remove`.
 */
function worktreeCandidates(absPosix) {
  const out = [];
  // <parent>/<name>.wt/<slug>/<tail>  ->  <parent>/<name>/<tail>
  const sibling = /^(.*)\/([^/]+)\.wt\/[^/]+\/(.+)$/.exec(absPosix);
  if (sibling) out.push(`${sibling[1]}/${sibling[2]}/${sibling[3]}`);
  // <repo>/.worktrees/<slug>/<tail>  ->  <repo>/<tail>
  const nested = /^(.*)\/\.worktrees\/[^/]+\/(.+)$/.exec(absPosix);
  if (nested) out.push(`${nested[1]}/${nested[2]}`);
  return out;
}

/** The deepest ancestor directory of `absPosix` that actually exists. */
function deepestExistingAncestor(absPosix) {
  let dir = path.posix.dirname(absPosix);
  for (let guard = 0; guard < 64; guard += 1) {
    const parent = path.posix.dirname(dir);
    if (statKind(dir) === 'dir') return dir;
    if (!dir || parent === dir) return '';
    dir = parent;
  }
  return '';
}

/**
 * Candidate search anchors, closest first: the deepest surviving directory,
 * then up to ANCHOR_LIFT_LEVELS of its parents. Closest-first means the
 * cheapest search runs first and a nearby match wins over a distant one.
 */
function searchAnchors(absPosix) {
  const deepest = deepestExistingAncestor(absPosix);
  if (!deepest) return [];
  const anchors = [];
  let dir = deepest;
  for (let lift = 0; lift <= ANCHOR_LIFT_LEVELS; lift += 1) {
    if (segmentsOf(dir).length < MIN_ANCHOR_SEGMENTS) break;
    anchors.push(dir);
    const parent = path.posix.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return anchors;
}

/**
 * Tier 3 — breadth-first walk under `anchor` for the best suffix match.
 * Returns '' when nothing clears MIN_SUFFIX_SEGMENTS or the budget runs out.
 * `budget` is shared across anchors so the worst case stays capped overall.
 */
function searchUnderAnchor(anchor, wantedSegs, budget) {
  const wantedBase = fold(wantedSegs[wantedSegs.length - 1]);
  let best = '';
  let bestScore = MIN_SUFFIX_SEGMENTS - 1;

  let frontier = [anchor];
  for (let depth = 0; depth <= MAX_DEPTH && frontier.length; depth += 1) {
    const next = [];
    for (const dir of frontier) {
      if (budget.left <= 0) return best;
      budget.left -= 1;

      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          next.push(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (fold(entry.name) !== wantedBase) continue;

        const score = commonSuffixLength(wantedSegs, segmentsOf(full));
        if (score > bestScore) {
          bestScore = score;
          best = full;
          // A full-length match cannot be beaten; stop paying for the walk.
          if (score === wantedSegs.length) return best;
        }
      }
    }
    frontier = next;
  }
  return best;
}

/** A candidate is only usable if it is a real file the caller could have asked for. */
function acceptable(candidatePosix) {
  const native = path.resolve(candidatePosix);
  if (isSecretPath(native)) return '';
  if (!assertWithinRoots(native).ok) return '';
  return statKind(native) === 'file' ? native : '';
}

/**
 * Resolve a requested absolute path to a file that exists.
 *
 * @param {string} absPath - Already-resolved, already-gate-checked absolute path.
 * @returns {{ path: string, via: 'exact'|'worktree'|'search' } | null}
 */
export function resolveLocalFile(absPath) {
  const requested = path.resolve(String(absPath || ''));

  // Tier 1: exact. Deliberately ahead of the cache: one stat is cheap, and a
  // file that has come BACK must start resolving again immediately rather
  // than serve a stale negative for the rest of the TTL.
  const requestedKind = statKind(requested);
  if (requestedKind === 'file') return { path: requested, via: 'exact' };

  // The path RESOLVES, it just isn't a file. Nothing was moved or lost, so
  // there is nothing to recover — and hunting for a same-named file elsewhere
  // would be both wrong and the most expensive branch in the module.
  if (requestedKind !== 'none') return null;

  const key = fold(toPosix(requested));
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  const absPosix = toPosix(requested);
  let found = null;

  // Tier 2: worktree conventions.
  for (const candidate of worktreeCandidates(absPosix)) {
    const ok = acceptable(candidate);
    if (ok) {
      found = { path: ok, via: 'worktree' };
      break;
    }
  }

  // Tier 3: anchored suffix search, widening outward until the budget is spent.
  if (!found) {
    const wantedSegs = segmentsOf(absPosix);
    if (wantedSegs.length >= MIN_SUFFIX_SEGMENTS) {
      const budget = { left: MAX_DIRS_VISITED };
      for (const anchor of searchAnchors(absPosix)) {
        const hit = searchUnderAnchor(anchor, wantedSegs, budget);
        const ok = hit ? acceptable(hit) : '';
        if (ok) {
          found = { path: ok, via: 'search' };
          break;
        }
        if (budget.left <= 0) break;
      }
    }
  }

  cacheSet(key, found);
  return found;
}

export default { resolveLocalFile, clearResolveCache };
