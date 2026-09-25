#!/usr/bin/env node
/**
 * verify-artifacts: every native module we ship is built for the platform and
 * architecture of the package it is in.
 *
 *   node scripts/release/verify-artifacts.mjs --platform mac --arch x64 --dist dist
 *
 * Checks the unpacked app electron-builder leaves in dist/ AND, for macOS, the
 * zips themselves (the zip is what Squirrel installs, and v0.6.6's Intel zip was
 * the broken artifact). Fails on any mismatch, and on finding no native module
 * at all, because a check that inspected nothing proves nothing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { binaryArch, archMatches, zipEntries, zipEntryHead } from './releaseLib.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const platform = arg('platform');
const arch = arg('arch', 'x64');
const dist = path.resolve(arg('dist', 'dist'));
if (!['win', 'mac', 'linux'].includes(platform)) {
  console.error('usage: verify-artifacts --platform win|mac|linux --arch x64|arm64 [--dist dist]');
  process.exit(2);
}

const problems = [];
let checked = 0;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, 4096, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}

// 1. Unpacked apps.
const unpackedDirs = {
  win: ['win-unpacked'],
  linux: ['linux-unpacked'],
  mac: [arch === 'arm64' ? 'mac-arm64' : 'mac'],
}[platform].map((d) => path.join(dist, d)).filter((d) => fs.existsSync(d));

if (unpackedDirs.length === 0) problems.push(`no unpacked ${platform}/${arch} app in ${dist}`);
for (const dir of unpackedDirs) {
  for (const file of walk(dir)) {
    if (!file.endsWith('.node')) continue;
    const found = binaryArch(readHead(file));
    checked++;
    const rel = path.relative(dist, file);
    if (!archMatches(found, platform, arch)) problems.push(`${rel}: ${found.format}/${found.arch}, expected ${platform}/${arch}`);
    else console.log(`ok   ${found.format}/${found.arch}  ${rel}`);
  }
}

// 2. macOS zips: what users actually download.
if (platform === 'mac') {
  const zips = fs.readdirSync(dist).filter((n) => new RegExp(`-mac-${arch}\\.zip$`).test(n));
  if (zips.length === 0) problems.push(`no *-mac-${arch}.zip in ${dist}`);
  for (const z of zips) {
    for (const entry of zipEntries(path.join(dist, z))) {
      if (!entry.name.endsWith('.node')) continue;
      const found = binaryArch(zipEntryHead(path.join(dist, z), entry));
      checked++;
      if (!archMatches(found, platform, arch)) problems.push(`${z}:${entry.name}: ${found.format}/${found.arch}, expected mac/${arch}`);
      else console.log(`ok   ${found.format}/${found.arch}  ${z}:${entry.name.split('node_modules/').pop()}`);
    }
  }
}

// 3. Only this runner's architecture. A runner can only verify what it can
//    run, so an installer for another CPU here is unverified by construction.
//    (The first release dry run built both Mac apps on each Mac runner.)
const OTHER_ARCH = { x64: ['arm64', 'ia32', 'universal'], arm64: ['x64', 'ia32', 'universal'] }[arch] || [];
for (const n of fs.readdirSync(dist)) {
  if (!/^AGNT-.*\.(exe|dmg|zip|AppImage|deb|rpm)$/.test(n)) continue;
  const tokens = n.replace(/\.[^.]+$/, '').split('-');
  if (OTHER_ARCH.some((a) => tokens.includes(a))) problems.push(`${n} is for another architecture than this ${platform}/${arch} runner`);
}
for (const d of fs.readdirSync(dist)) {
  if (platform === 'mac' && /^mac(-arm64|-universal)?$/.test(d) && !unpackedDirs.includes(path.join(dist, d))) {
    problems.push(`${d}/ holds a Mac app for another architecture than this ${arch} runner`);
  }
}

// 4. Nothing from a retired variant, nothing unnamed.
for (const n of fs.readdirSync(dist)) {
  if (/lite/i.test(n) && /\.(exe|dmg|zip|AppImage|deb|rpm|yml|blockmap)$/.test(n)) problems.push(`retired variant in dist: ${n}`);
}

if (checked === 0) problems.push('no native module found to check (the scan inspected nothing)');

if (problems.length) {
  console.error(`\nverify-artifacts FAILED for ${platform}/${arch} (${checked} native binaries checked):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\nverify-artifacts: ${checked} native binaries are ${platform}/${arch}`);
