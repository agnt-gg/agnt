#!/usr/bin/env node
/**
 * verify-release: the DRAFT on GitHub holds exactly what the manifest says,
 * before anyone can see it.
 *
 *   node scripts/release/verify-release.mjs --tag v0.6.7 --manifest release/release-manifest.json
 *
 * Reads the draft with `gh release view` (drafts are invisible to the public
 * API and to clients), then requires: every manifest asset present with the
 * same size, release-manifest.json and the three feeds present, nothing else.
 * The small files are downloaded and hash-checked against the local copies.
 * Only a release that passes is published; v0.6.2 to v0.6.5 were published
 * with zero assets, and a published empty release breaks every client's check.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateManifest } from './releaseLib.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const tag = arg('tag');
const manifestPath = arg('manifest');
if (!tag || !manifestPath) {
  console.error('usage: verify-release --tag <tag> --manifest <release-manifest.json>');
  process.exit(2);
}
const localDir = path.dirname(path.resolve(manifestPath));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const problems = validateManifest(manifest, tag.replace(/^v/, ''));

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const view = JSON.parse(gh('release', 'view', tag, '--json', 'isDraft,assets,tagName'));
if (!view.isDraft) problems.push(`${tag} is already published; verify-release checks drafts`);

const remote = new Map(view.assets.map((a) => [a.name, a]));
const SIDECARS = ['release-manifest.json', 'latest.yml', 'latest-mac.yml', 'latest-linux.yml'];
for (const a of manifest.assets) {
  const r = remote.get(a.name);
  if (!r) problems.push(`draft is missing ${a.name}`);
  else if (r.size !== a.size) problems.push(`draft ${a.name} is ${r.size} bytes, manifest says ${a.size}`);
}
for (const s of SIDECARS) if (!remote.has(s)) problems.push(`draft is missing ${s}`);
const expected = new Set([...manifest.assets.map((a) => a.name), ...SIDECARS]);
for (const name of remote.keys()) if (!expected.has(name)) problems.push(`draft has unexpected asset ${name}`);

// The small files: download and compare byte-for-byte.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-release-'));
try {
  gh('release', 'download', tag, '--dir', tmp, ...SIDECARS.flatMap((s) => ['--pattern', s]));
  const h = (p) => crypto.createHash('sha512').update(fs.readFileSync(p)).digest('base64');
  for (const s of SIDECARS) {
    const got = path.join(tmp, s);
    const want = path.join(localDir, s);
    if (!fs.existsSync(got)) continue; // already reported as missing
    if (fs.existsSync(want) && h(got) !== h(want)) problems.push(`draft ${s} differs from the validated local copy`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (problems.length) {
  console.error(`verify-release FAILED for ${tag}:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`verify-release: draft ${tag} holds exactly ${manifest.assets.length} assets + ${SIDECARS.length} feed files`);
