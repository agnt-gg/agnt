#!/usr/bin/env node
/**
 * Vendors the hosted scrape converter (agnt-server, api.agnt.gg) into the desktop app.
 *
 *   node scripts/sync-scrape-upstream.mjs            copy upstream -> vendored, rewrite SOURCE.json
 *   node scripts/sync-scrape-upstream.mjs --check    exit 1 if the vendored copy differs from upstream
 *   ... --from <path to agnt-server/api.agnt.gg>     default: the sibling agnt-server checkout
 *
 * WHY A VERBATIM COPY
 * The desktop web_scrape and scrape.agnt.gg must turn the same page or file into the same
 * markdown. Two implementations drift (they did: the desktop one never learned files, tables
 * or shadow DOM). So the converter has ONE source, upstream, and the desktop runs it byte for
 * byte, its own tests included. Fix a conversion bug upstream, then run this.
 * backend/src/services/scrape/upstream.integrity.test.js fails if anyone edits the copy here.
 *
 * Line endings are normalised to LF on both sides: the two checkouts use different
 * core.autocrlf settings, and a CRLF difference is not a code difference.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VENDOR_DIR = path.join(REPO_ROOT, 'backend', 'src', 'services', 'scrape', 'upstream');
export const MANIFEST = path.join(VENDOR_DIR, 'SOURCE.json');

// upstream path (relative to api.agnt.gg) -> vendored path (relative to VENDOR_DIR).
// The layout mirrors upstream so every relative import resolves unchanged. The node:test
// suites are renamed *.nodetest.js only so vitest's *.test.js discovery leaves them to
// node --test (see upstream.integrity.test.js, which runs them).
export const FILES = Object.freeze({
  'src/services/ScrapePolicy.js': 'src/services/ScrapePolicy.js',
  'src/services/scrape/extract.js': 'src/services/scrape/extract.js',
  'src/services/scrape/documents.js': 'src/services/scrape/documents.js',
  'src/services/scrape/convert.js': 'src/services/scrape/convert.js',
  'src/services/scrape/convert-thread.mjs': 'src/services/scrape/convert-thread.mjs',
  'tests/scrape-extract.test.js': 'tests/scrape-extract.nodetest.js',
  'tests/scrape-documents.test.js': 'tests/scrape-documents.nodetest.js',
});

export const normalizedText = (buffer) => buffer.toString('utf8').replace(/\r\n/g, '\n');
export const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

function findUpstream(explicit) {
  const isUpstream = (dir) => fs.existsSync(path.join(dir, 'src', 'services', 'ScrapePolicy.js'));
  if (explicit) {
    if (!isUpstream(explicit)) throw new Error(`${explicit} is not agnt-server/api.agnt.gg`);
    return explicit;
  }
  if (process.env.AGNT_SERVER_API_DIR && isUpstream(process.env.AGNT_SERVER_API_DIR)) return process.env.AGNT_SERVER_API_DIR;
  // A worktree lives under <repo>/.worktrees/<slug>: walk up until a sibling agnt-server appears.
  for (let dir = REPO_ROOT; ; dir = path.dirname(dir)) {
    const sibling = path.join(path.dirname(dir), 'agnt-server', 'api.agnt.gg');
    if (isUpstream(sibling)) return sibling;
    if (path.dirname(dir) === dir) throw new Error('agnt-server/api.agnt.gg not found; pass --from <path>');
  }
}

function upstreamCommit(upstreamDir) {
  const git = (...args) => execFileSync('git', ['-C', upstreamDir, ...args], { encoding: 'utf8' }).trim();
  const dirty = git('status', '--porcelain', '--', ...Object.keys(FILES));
  return { commit: git('rev-parse', 'HEAD'), dirty: dirty.length > 0 };
}

function main(argv) {
  const check = argv.includes('--check');
  const fromIndex = argv.indexOf('--from');
  const upstreamDir = findUpstream(fromIndex >= 0 ? argv[fromIndex + 1] : undefined);
  const drift = [];
  const files = {};
  for (const [upstreamRel, vendoredRel] of Object.entries(FILES)) {
    const text = normalizedText(fs.readFileSync(path.join(upstreamDir, upstreamRel)));
    const target = path.join(VENDOR_DIR, vendoredRel);
    const current = fs.existsSync(target) ? normalizedText(fs.readFileSync(target)) : null;
    if (current !== text) drift.push(vendoredRel);
    files[vendoredRel] = { upstream: upstreamRel, sha256: sha256(text) };
    if (!check && current !== text) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
    }
  }
  if (check) {
    if (drift.length) {
      console.error(`Vendored scrape converter differs from ${upstreamDir}:\n  ${drift.join('\n  ')}\nRun: node scripts/sync-scrape-upstream.mjs`);
      process.exit(1);
    }
    console.log(`In sync with ${upstreamDir}`);
    return;
  }
  const { commit, dirty } = upstreamCommit(upstreamDir);
  // A copy of uncommitted upstream work could never be reproduced from history; refuse it.
  if (dirty && !argv.includes('--allow-dirty')) {
    throw new Error('upstream scrape files have uncommitted changes; commit them first (or pass --allow-dirty)');
  }
  const manifest = { upstream: 'agnt-server/api.agnt.gg', commit: commit + (dirty ? '+dirty' : ''), files };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${drift.length ? 'Updated ' + drift.join(', ') : 'Already in sync'}; SOURCE.json at ${commit.slice(0, 8)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(1); }
}
