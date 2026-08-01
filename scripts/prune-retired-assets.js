/**
 * PRUNE RETIRED ASSETS (electron-builder `beforePack` hook)
 *
 * `frontend/dist` is built with `emptyOutDir: false` and keeps previously
 * emitted content hashes alive for a retention window, because the backend
 * serves that directory IN PLACE and a running renderer is still holding the
 * old filenames (see frontend/build/assetRetention.js).
 *
 * An installer has no such constraint: nobody has a live session against a file
 * that does not exist yet. Shipping the retained hashes would just grow the
 * package by every rebuild made in the last week.
 *
 * The retention ledger is the exact list of files that are no longer current,
 * so pruning is precise — no globbing, no guessing, and nothing the current
 * build references can be removed.
 *
 * Wired as `beforePack` so it runs for EVERY target (build, build:win,
 * build:lite, ...) rather than depending on someone exporting an env var.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'frontend', 'dist');
const LEDGER = path.join(DIST, '.asset-retention.json');

export function pruneRetiredAssets({ dist = DIST, ledgerFile = LEDGER, log = console.log } = {}) {
  if (!fs.existsSync(ledgerFile)) return { removed: [], missing: [] };

  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  } catch {
    // A corrupt ledger must not abort a release build. Worst case the package
    // carries a few stale chunks.
    log('[prune] retention ledger unreadable; leaving dist untouched');
    return { removed: [], missing: [] };
  }

  const removed = [];
  const missing = [];

  for (const rel of Object.keys(ledger)) {
    const full = path.join(dist, rel);
    // Refuse to follow a ledger entry outside dist.
    if (!path.resolve(full).startsWith(path.resolve(dist))) continue;
    if (!fs.existsSync(full)) {
      missing.push(rel);
      continue;
    }
    fs.unlinkSync(full);
    removed.push(rel);
  }

  fs.writeFileSync(ledgerFile, JSON.stringify({}, null, 2));
  log(`[prune] removed ${removed.length} retired asset(s) from the package`);
  return { removed, missing };
}

export default async function beforePack() {
  pruneRetiredAssets();
}

// Also runnable directly: `node scripts/prune-retired-assets.js`
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  pruneRetiredAssets();
}
