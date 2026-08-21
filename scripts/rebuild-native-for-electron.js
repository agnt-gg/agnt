#!/usr/bin/env node
/**
 * Make every native module loadable by ELECTRON, not just by Node.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS REPAIRS
 * ---------------------------------------------------------------------------
 * AGNT 0.6.6 shipped an installer that could not start. Three seconds after
 * launch the backend died with 0xC0000005 and the window closed — on every
 * machine, including a clean install of the published release.
 *
 * The cause was one native module built for the wrong runtime. sqlite3's own
 * install script is
 *
 *     prebuild-install -r napi || node-gyp rebuild
 *
 * and the hardcoded `-r napi` overrides the Electron target that
 * `electron-builder install-app-deps` sets. The download then 404s (there is no
 * napi prebuild for that version), the `||` fallback runs bare `node-gyp
 * rebuild`, and node-gyp builds against whatever Node is on PATH.
 *
 * On Windows that difference is fatal rather than cosmetic. A Node-targeted
 * addon binds its imports against `node.exe`; loaded inside `electron.exe` the
 * binding fails as an access violation. No exception is thrown and nothing is
 * printed, so a try/catch cannot see it and the process is simply gone.
 * `--runtime=electron` is what makes node-gyp compile `win_delay_load_hook.cc`,
 * which is the piece that resolves those imports against the host executable
 * whatever it happens to be called.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS NOT ENOUGH TO INSPECT THE FILE
 * ---------------------------------------------------------------------------
 * Every cheap check passes on a broken binary. It exists. Its size is right.
 * It even exports `napi_register_module_v1`, so an "is this N-API?" test says
 * yes — N-API is ABI-stable across runtimes, but that stability is about symbol
 * versions and says nothing about how Windows resolves the imports.
 *
 * So this asks the only question that separates the two: load it in Electron.
 * Each module is probed in its own process, because an ABI abort takes the
 * process down and would hide every module checked after it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS WARNS RATHER THAN FAILS
 * ---------------------------------------------------------------------------
 * A machine with no C++ toolchain cannot rebuild anything, and failing
 * `npm install` there would block contributors who only ever run the dev
 * server — where the backend is a forked REAL Node process and none of this
 * matters. The build is where it becomes real, so that is where it is
 * enforced: scripts/electron-builder-hooks.js re-runs this probe against the
 * PACKAGED app and refuses to finish a build that would not start.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE_MODULES = path.join(ROOT, 'node_modules');

const say = (s) => console.log(`[native] ${s}`);

/** The Electron the app will actually run inside. */
function electronVersion() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(NODE_MODULES, 'electron', 'package.json'), 'utf8'),
    ).version;
  } catch {
    return null;
  }
}

/** The Electron binary, for probing. */
function electronBinary() {
  const pathFile = path.join(NODE_MODULES, 'electron', 'path.txt');
  try {
    const rel = fs.readFileSync(pathFile, 'utf8').trim();
    const full = path.join(NODE_MODULES, 'electron', 'dist', rel);
    return fs.existsSync(full) ? full : null;
  } catch {
    return null;
  }
}

/** Top-level packages shipping a .node binary. Derived, never hand-listed. */
function nativePackages() {
  if (!fs.existsSync(NODE_MODULES)) return [];

  const hasNode = (dir) => {
    const stack = [dir];
    while (stack.length) {
      let entries;
      const cur = stack.pop();
      try {
        entries = fs.readdirSync(cur, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        // node_modules of a dependency is that dependency's problem.
        if (e.isDirectory() && e.name !== 'node_modules') stack.push(path.join(cur, e.name));
        else if (e.isFile() && e.name.endsWith('.node')) return true;
      }
    }
    return false;
  };

  const out = [];
  for (const entry of fs.readdirSync(NODE_MODULES, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      const scope = path.join(NODE_MODULES, entry.name);
      for (const sub of fs.readdirSync(scope, { withFileTypes: true })) {
        if (sub.isDirectory() && hasNode(path.join(scope, sub.name))) {
          out.push(`${entry.name}/${sub.name}`);
        }
      }
    } else if (hasNode(path.join(NODE_MODULES, entry.name))) {
      out.push(entry.name);
    }
  }
  return out.sort();
}

/**
 * Does this package load inside Electron?
 *
 * Its own process, because an ABI abort is not catchable and would end this one.
 */
function loadsInElectron(exe, pkg) {
  const target = path.join(NODE_MODULES, pkg).replace(/\\/g, '/');
  const res = spawnSync(exe, ['-e', `require(${JSON.stringify(target)})`], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: 90000,
    windowsHide: true,
  });
  return { ok: res.status === 0, detail: (res.stderr || '').trim().split('\n')[0] || `exit ${res.status ?? res.signal}` };
}

/** node-gyp, wherever this package keeps it. */
function findNodeGyp(pkgDir) {
  const candidates = [
    path.join(pkgDir, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
    path.join(NODE_MODULES, 'node-gyp', 'bin', 'node-gyp.js'),
    path.join(NODE_MODULES, 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
  ];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

/**
 * Rebuild one package against Electron's headers.
 *
 * `--runtime=electron` is the flag that matters: it is what adds the Windows
 * delay-load hook. Everything else here just tells node-gyp where to find the
 * right headers.
 */
function rebuildForElectron(pkg, version) {
  const pkgDir = path.join(NODE_MODULES, pkg);
  if (!fs.existsSync(path.join(pkgDir, 'binding.gyp'))) {
    say(`  ${pkg}: no binding.gyp — cannot rebuild from source, leaving it alone`);
    return false;
  }

  const gyp = findNodeGyp(pkgDir);
  if (!gyp) {
    say(`  ${pkg}: node-gyp not found — cannot rebuild`);
    return false;
  }

  say(`  ${pkg}: rebuilding against Electron ${version}…`);
  const res = spawnSync(
    process.execPath,
    [
      gyp,
      'rebuild',
      '--runtime=electron',
      `--target=${version}`,
      '--dist-url=https://electronjs.org/headers',
      `--arch=${process.arch}`,
      '--build-from-source',
    ],
    { cwd: pkgDir, encoding: 'utf8', timeout: 15 * 60 * 1000, windowsHide: true },
  );

  if (res.status !== 0) {
    const tail = (res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' | ');
    say(`  ${pkg}: rebuild FAILED — ${tail.slice(0, 300)}`);
    return false;
  }
  return true;
}

// ── run ────────────────────────────────────────────────────────────────────
const version = electronVersion();
const exe = electronBinary();

if (!version || !exe) {
  say('electron not installed — skipping (nothing to target)');
  process.exit(0);
}

// Can the probe itself run? On a headless CI box Electron may be missing shared
// libraries and fail to start for reasons that have nothing to do with any
// module. Without this check every module would look broken, every one would be
// pointlessly rebuilt, and the build gate would fail a perfectly good tree.
const canProbe = spawnSync(exe, ['-e', 'process.exit(0)'], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 60000,
  windowsHide: true,
});
if (canProbe.status !== 0) {
  say(`⚠ cannot run Electron here (${(canProbe.stderr || '').trim().split('\n')[0] || `exit ${canProbe.status}`})`);
  say('  skipping — native modules CANNOT be verified on this machine');
  process.exit(0);
}

const packages = nativePackages();
if (packages.length === 0) {
  say('no native modules found');
  process.exit(0);
}

say(`checking ${packages.length} native module(s) against Electron ${version}`);

const stillBroken = [];
for (const pkg of packages) {
  const first = loadsInElectron(exe, pkg);
  if (first.ok) {
    say(`  ok    ${pkg}`);
    continue;
  }

  say(`  BROKEN ${pkg} — ${first.detail}`);
  if (!rebuildForElectron(pkg, version)) {
    stillBroken.push(pkg);
    continue;
  }

  // Trust nothing: a rebuild that exits 0 has still not been shown to load.
  const second = loadsInElectron(exe, pkg);
  if (second.ok) say(`  fixed ${pkg}`);
  else {
    say(`  STILL BROKEN ${pkg} — ${second.detail}`);
    stillBroken.push(pkg);
  }
}

if (stillBroken.length > 0) {
  say('');
  say(`\u26a0 ${stillBroken.length} native module(s) cannot load in Electron: ${stillBroken.join(', ')}`);
  say('  The dev server is unaffected — it forks real Node — but a PACKAGED build');
  say('  made from this tree would install and then fail to start. The build will');
  say('  refuse to finish until this is resolved.');
}

// Never fails the install: see the header.
process.exit(0);
