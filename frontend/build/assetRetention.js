/**
 * ASSET RETENTION
 *
 * Vite's `emptyOutDir` wipes `dist/` before every build. That is correct for a
 * deploy-to-CDN world and wrong for ours: the backend serves `dist/` in place,
 * and an Electron renderer that has been open across a rebuild is still holding
 * the PREVIOUS content hashes. Deleting them turns every not-yet-loaded lazy
 * screen in that session into a 200-OK `index.html` (the SPA catch-all), which
 * the browser refuses to execute as a module. The window looks fine; the screen
 * is blank.
 *
 * So: build without emptying, and retire old hashes on a timer instead of
 * deleting them the instant they stop being current. A retired file survives
 * `retentionMs` from the first build that stopped referencing it, which covers
 * every session that was open when it went stale.
 *
 * Only content-hashed files are managed. Anything else under `assets/`
 * (`assets/icons/**`, copied verbatim by the copy-directory plugin) is never
 * a candidate for deletion — the hash pattern is the safety interlock.
 */

import fs from 'fs';
import path from 'path';

export const DEFAULT_RETENTION_DAYS = 7;
export const LEDGER_FILENAME = '.asset-retention.json';

/**
 * Vite emits `name.[hash].ext`, where hash is 8 base64url characters:
 *   index.CcrGhO7w.js   Settings.B4rtEn8e.js   blockDiagram-677ZJIJ3.kkhj03wU.js
 * Verbatim-copied assets (icons) have no such segment and never match.
 */
const HASHED_FILE = /\.[A-Za-z0-9_-]{8}\.[A-Za-z0-9]+$/;

export function isHashedAssetName(fileName) {
  return HASHED_FILE.test(fileName);
}

/**
 * Pure retention planner.
 *
 * @param {object}   args
 * @param {string[]} args.existing     Hashed files currently on disk (posix-relative to outDir).
 * @param {string[]} args.live         Hashed files this build just emitted.
 * @param {Record<string, number>} [args.ledger]  filename -> first-retired-at (ms).
 * @param {number}   args.now
 * @param {number}   args.retentionMs  0 deletes retired files immediately.
 * @returns {{ keep: string[], remove: string[], ledger: Record<string, number> }}
 */
export function planAssetRetention({ existing, live, ledger = {}, now, retentionMs }) {
  const liveSet = new Set(live);
  const keep = [];
  const remove = [];
  const nextLedger = {};

  for (const file of existing) {
    if (liveSet.has(file)) {
      // Re-emitted with the same hash: current again, so it carries no
      // retirement date. (Identical content always produces the same hash.)
      keep.push(file);
      continue;
    }

    const recorded = ledger[file];
    // Unknown, corrupt, or future-dated marks all reset to "retired now" so a
    // bad ledger can only ever extend a file's life, never shorten it.
    const retiredAt = Number.isFinite(recorded) && recorded <= now ? recorded : now;

    if (now - retiredAt >= retentionMs) {
      remove.push(file);
    } else {
      keep.push(file);
      nextLedger[file] = retiredAt;
    }
  }

  return { keep, remove, ledger: nextLedger };
}

/** Recursively list files under `dir`, as posix paths relative to `dir`. */
export function listFilesRecursive(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function readLedger(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Vite plugin. Pair with `build.emptyOutDir: false`.
 *
 * `AGNT_ASSET_RETENTION_DAYS=0` restores the old wipe-immediately behaviour,
 * which is what a packaged release build wants (nobody has a live session
 * against an installer).
 */
export function preserveHashedAssets(options = {}) {
  const {
    retentionDays = Number(process.env.AGNT_ASSET_RETENTION_DAYS ?? DEFAULT_RETENTION_DAYS),
    assetsDir = 'assets',
    log = console.log,
  } = options;

  const retentionMs = Math.max(0, Number.isFinite(retentionDays) ? retentionDays : DEFAULT_RETENTION_DAYS) * 86_400_000;
  let outDirAbs = null;
  // Closure, not `this`: rollup calls hooks with a plugin CONTEXT, so state
  // stashed on `this` in one hook is not there in the next.
  let live = [];

  return {
    name: 'agnt-preserve-hashed-assets',
    apply: 'build',

    configResolved(config) {
      outDirAbs = path.resolve(config.root, config.build.outDir);
      if (config.build.emptyOutDir) {
        // Not fatal, but the plugin is pointless in that configuration and the
        // silent version of this mistake is the bug we are fixing.
        log('[assets] WARNING: build.emptyOutDir is true — retired chunks will be deleted anyway.');
      }
    },

    // The bundle is the authoritative list of what this build emitted — far
    // more reliable than comparing mtimes, which the copy plugin also touches.
    writeBundle(_options, bundle) {
      live = Object.keys(bundle)
        .map((key) => key.split(path.sep).join('/'))
        .filter((rel) => isHashedAssetName(path.basename(rel)));
    },

    // closeBundle runs after every write, including the sibling copy plugin.
    closeBundle() {
      if (!outDirAbs) return;
      const assetsRoot = path.join(outDirAbs, assetsDir);
      if (!fs.existsSync(assetsRoot)) return;

      const prefix = `${assetsDir}/`;
      const existing = listFilesRecursive(assetsRoot)
        .map((rel) => prefix + rel)
        .filter((rel) => isHashedAssetName(path.basename(rel)));

      const ledgerFile = path.join(outDirAbs, LEDGER_FILENAME);
      const now = Date.now();
      const { remove, ledger } = planAssetRetention({
        existing,
        live,
        ledger: readLedger(ledgerFile),
        now,
        retentionMs,
      });

      for (const rel of remove) {
        try {
          fs.unlinkSync(path.join(outDirAbs, rel));
        } catch {
          /* already gone */
        }
      }

      fs.mkdirSync(outDirAbs, { recursive: true });
      fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2));

      const retained = Object.keys(ledger).length;
      log(`[assets] ${live.length} current, ${retained} retained for ${retentionDays}d, ${remove.length} pruned`);
    },
  };
}
