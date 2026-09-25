#!/usr/bin/env node
/**
 * release-manifest: describe a release exactly, and refuse to describe a bad one.
 *
 *   node scripts/release/release-manifest.mjs --tag v0.6.7 --dir release [--allow-partial]
 *
 * Reads the three feeds (latest.yml, latest-mac.yml, latest-linux.yml) and
 * every AGNT-<version>-* file in --dir, hashes each file, and writes
 * <dir>/release-manifest.json: the document agnt.gg's update feed is built from.
 * It then runs the same validation the server runs and exits 1 on any problem,
 * so a release the server would refuse is never published.
 *
 * --allow-partial (local rehearsals only): write the manifest even when a
 * platform is missing, and report those problems without failing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseLatestYml, feedFromYml, sha512File, validateManifest } from './releaseLib.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const tag = arg('tag');
const dir = path.resolve(arg('dir') || 'release');
const allowPartial = process.argv.includes('--allow-partial');
if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag || '')) {
  console.error('usage: release-manifest --tag v<semver> --dir <dir> [--allow-partial]');
  process.exit(2);
}
const version = tag.slice(1);

const feeds = {};
for (const [platform, file] of [['win', 'latest.yml'], ['mac', 'latest-mac.yml'], ['linux', 'latest-linux.yml']]) {
  const p = path.join(dir, file);
  if (fs.existsSync(p)) feeds[platform] = feedFromYml(parseLatestYml(fs.readFileSync(p, 'utf8')));
}

const assets = [];
for (const name of fs.readdirSync(dir).sort()) {
  if (name === 'release-manifest.json' || /^latest.*\.yml$/.test(name)) continue;
  const p = path.join(dir, name);
  if (!fs.statSync(p).isFile()) continue;
  assets.push({ name, sha512: await sha512File(p), size: fs.statSync(p).size });
}

const manifest = {
  schema: 1,
  product: 'AGNT',
  version,
  tag,
  createdAt: new Date().toISOString(),
  assets,
  feeds,
};
const problems = validateManifest(manifest, version);
fs.writeFileSync(path.join(dir, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`release-manifest: ${assets.length} assets, feeds: ${Object.keys(feeds).join(', ') || 'none'}`);
if (problems.length) {
  console[allowPartial ? 'log' : 'error'](`${allowPartial ? 'partial release (allowed)' : 'release-manifest FAILED'}:`);
  for (const p of problems) console[allowPartial ? 'log' : 'error'](`  - ${p}`);
  if (!allowPartial) process.exit(1);
}
