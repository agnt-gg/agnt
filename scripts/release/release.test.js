/**
 * Release tooling. Every case here is a shipped failure or the check that
 * would have stopped it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseLatestYml, renderLatestYml, mergeMacFeeds, binaryArch, archMatches,
  zipEntries, zipEntryHead, validateManifest, feedFromYml,
} from './releaseLib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const run = (script, args, cwd) => spawnSync(process.execPath, [path.join(here, script), ...args], { cwd, encoding: 'utf8' });
const b64 = (s) => crypto.createHash('sha512').update(s).digest('base64');

// ---- binary headers --------------------------------------------------------
function pe(machine) {
  const b = Buffer.alloc(256);
  b[0] = 0x4d; b[1] = 0x5a; b.writeUInt32LE(0x80, 0x3c); b.writeUInt32LE(0x00004550, 0x80); b.writeUInt16LE(machine, 0x84);
  return b;
}
function macho(cpu) {
  const b = Buffer.alloc(256);
  b.writeUInt32LE(0xfeedfacf, 0); b.writeUInt32LE(cpu, 4);
  return b;
}
function elf(machine) {
  const b = Buffer.alloc(256);
  b.writeUInt32BE(0x7f454c46, 0); b.writeUInt16LE(machine, 18);
  return b;
}
const MACHO_ARM64 = macho(0x0100000c);
const MACHO_X64 = macho(0x01000007);

describe('binaryArch', () => {
  it('reads PE, Mach-O and ELF headers', () => {
    expect(binaryArch(pe(0x8664))).toEqual({ format: 'pe', arch: 'x64' });
    expect(binaryArch(MACHO_ARM64)).toEqual({ format: 'macho', arch: 'arm64' });
    expect(binaryArch(MACHO_X64)).toEqual({ format: 'macho', arch: 'x64' });
    expect(binaryArch(elf(62))).toEqual({ format: 'elf', arch: 'x64' });
    expect(binaryArch(Buffer.from('not a binary'.padEnd(80)))).toEqual({ format: 'unknown', arch: null });
  });

  it('THE v0.6.6 DEFECT: an arm64 module does not match an Intel Mac', () => {
    expect(archMatches(binaryArch(MACHO_ARM64), 'mac', 'x64')).toBe(false);
    expect(archMatches(binaryArch(MACHO_X64), 'mac', 'x64')).toBe(true);
    expect(archMatches(binaryArch(pe(0x8664)), 'mac', 'x64')).toBe(false);
  });

  it('reads a real native module from this install', () => {
    const real = path.resolve(here, '../../node_modules/sqlite3/build/Release/node_sqlite3.node');
    if (!fs.existsSync(real)) return; // not every checkout has it built
    const expected = { win32: 'pe', darwin: 'macho', linux: 'elf' }[process.platform];
    expect(binaryArch(fs.readFileSync(real)).format).toBe(expected);
  });
});

// ---- zip ---------------------------------------------------------------------
/** A stored (uncompressed) zip, built by hand: enough to exercise the reader. */
function storedZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-test-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('zip reader', () => {
  it('finds a native module inside a zip and reads its architecture', () => {
    const z = path.join(tmp, 'a.zip');
    fs.writeFileSync(z, storedZip([['AGNT.app/Contents/Info.plist', Buffer.from('x')], ['AGNT.app/x/node_sqlite3.node', MACHO_ARM64]]));
    const entries = zipEntries(z);
    expect(entries.map((e) => e.name)).toEqual(['AGNT.app/Contents/Info.plist', 'AGNT.app/x/node_sqlite3.node']);
    expect(binaryArch(zipEntryHead(z, entries[1]))).toEqual({ format: 'macho', arch: 'arm64' });
  });
});

// ---- verify-artifacts CLI ----------------------------------------------------
describe('verify-artifacts', () => {
  const mod = (dir, name, buf) => {
    const p = path.join(dir, 'resources', 'app.asar.unpacked', 'node_modules', name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, buf);
  };

  it('passes an Intel Mac build whose app and zip are x64', () => {
    mod(path.join(tmp, 'mac'), 'sqlite3/node_sqlite3.node', MACHO_X64);
    fs.writeFileSync(path.join(tmp, 'AGNT-0.6.7-mac-x64.zip'), storedZip([['AGNT.app/a/node_sqlite3.node', MACHO_X64]]));
    const r = run('verify-artifacts.mjs', ['--platform', 'mac', '--arch', 'x64', '--dist', tmp]);
    expect(r.status, r.stderr).toBe(0);
  });

  it('THE v0.6.6 DEFECT: an Intel zip holding an arm64 module fails', () => {
    mod(path.join(tmp, 'mac'), 'sqlite3/node_sqlite3.node', MACHO_X64);
    fs.writeFileSync(path.join(tmp, 'AGNT-0.6.7-mac-x64.zip'), storedZip([['AGNT.app/a/node_sqlite3.node', MACHO_ARM64]]));
    const r = run('verify-artifacts.mjs', ['--platform', 'mac', '--arch', 'x64', '--dist', tmp]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/macho\/arm64, expected mac\/x64/);
  });

  it('a Windows build with a non-PE module fails', () => {
    mod(path.join(tmp, 'win-unpacked'), 'sharp/sharp.node', elf(62));
    const r = run('verify-artifacts.mjs', ['--platform', 'win', '--arch', 'x64', '--dist', tmp]);
    expect(r.status).toBe(1);
  });

  it('finding nothing to check is a failure, not a pass', () => {
    fs.mkdirSync(path.join(tmp, 'linux-unpacked'));
    const r = run('verify-artifacts.mjs', ['--platform', 'linux', '--arch', 'x64', '--dist', tmp]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/inspected nothing/);
  });

  it('a Lite artifact in dist fails', () => {
    mod(path.join(tmp, 'win-unpacked'), 'sqlite3/a.node', pe(0x8664));
    fs.writeFileSync(path.join(tmp, 'AGNT-Lite-0.6.7-win-x64.exe'), 'x');
    const r = run('verify-artifacts.mjs', ['--platform', 'win', '--arch', 'x64', '--dist', tmp]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/retired variant/);
  });
});

// ---- feeds -------------------------------------------------------------------
const V = '0.6.7';
const yml = (files, extra = '') =>
  `version: ${V}\nfiles:\n${files.map(([n, s, b]) => `  - url: ${n}\n    sha512: ${b64(n)}\n    size: ${s}${b ? `\n    blockMapSize: ${b}` : ''}`).join('\n')}\npath: ${files[0][0]}\nsha512: ${b64(files[0][0])}\nreleaseDate: '2026-09-25T12:00:00.000Z'\n${extra}`;

describe('latest.yml', () => {
  it('round-trips electron-builder output', () => {
    const text = yml([[`AGNT-${V}-mac-arm64.zip`, 100, 7], [`AGNT-${V}-mac-arm64.dmg`, 200]]);
    const doc = parseLatestYml(text);
    expect(doc.version).toBe(V);
    expect(doc.files).toHaveLength(2);
    expect(doc.files[0]).toMatchObject({ url: `AGNT-${V}-mac-arm64.zip`, size: 100, blockMapSize: 7 });
    expect(parseLatestYml(renderLatestYml(doc))).toEqual(doc);
  });

  it('keeps a prerelease version a string', () => {
    expect(parseLatestYml(`version: 0.6.7-rc.1\nfiles:\n  - url: a\n    sha512: b\n    size: 1\npath: a\nsha512: b\nreleaseDate: 'x'\n`).version).toBe('0.6.7-rc.1');
  });

  it('merges the two Mac feeds; the Intel zip stays the legacy path', () => {
    const arm = parseLatestYml(yml([[`AGNT-${V}-mac-arm64.zip`, 1], [`AGNT-${V}-mac-arm64.dmg`, 2]]));
    const x64 = parseLatestYml(yml([[`AGNT-${V}-mac-x64.zip`, 3], [`AGNT-${V}-mac-x64.dmg`, 4]]));
    const m = mergeMacFeeds(arm, x64);
    expect(m.files.map((f) => f.url)).toHaveLength(4);
    expect(m.path).toBe(`AGNT-${V}-mac-x64.zip`);
  });

  it('refuses to merge feeds of different versions, or one file with two hashes', () => {
    const a = parseLatestYml(yml([[`AGNT-${V}-mac-arm64.zip`, 1]]));
    expect(() => mergeMacFeeds(a, { ...a, version: '0.6.8' })).toThrow(/version/);
    expect(() => mergeMacFeeds(a, { ...a, files: [{ ...a.files[0], sha512: 'other' }] })).toThrow(/different sha512/);
  });
});

// ---- manifest ------------------------------------------------------------------
function writeRelease(dir, { lite = false, dropIntel = false, empty = false } = {}) {
  const files = empty ? [] : [
    `AGNT-${V}-win-x64.exe`, `AGNT-${V}-win-x64.exe.blockmap`,
    `AGNT-${V}-mac-arm64.zip`, `AGNT-${V}-mac-arm64.zip.blockmap`, `AGNT-${V}-mac-arm64.dmg`,
    ...(dropIntel ? [] : [`AGNT-${V}-mac-x64.zip`, `AGNT-${V}-mac-x64.zip.blockmap`, `AGNT-${V}-mac-x64.dmg`]),
    `AGNT-${V}-linux-x86_64.AppImage`, `AGNT-${V}-linux-amd64.deb`, `AGNT-${V}-linux-x86_64.rpm`,
    ...(lite ? [`AGNT-Lite-${V}-win-x64.exe`] : []),
  ];
  for (const f of files) fs.writeFileSync(path.join(dir, f), `bytes of ${f}`);
  const entry = (n) => `  - url: ${n}\n    sha512: ${crypto.createHash('sha512').update(`bytes of ${n}`).digest('base64')}\n    size: ${Buffer.byteLength(`bytes of ${n}`)}`;
  const feed = (names) => `version: ${V}\nfiles:\n${names.map(entry).join('\n')}\npath: ${names[0]}\nsha512: x\nreleaseDate: '2026-09-25T12:00:00.000Z'\n`;
  if (empty) return;
  fs.writeFileSync(path.join(dir, 'latest.yml'), feed([lite ? `AGNT-Lite-${V}-win-x64.exe` : `AGNT-${V}-win-x64.exe`]));
  fs.writeFileSync(path.join(dir, 'latest-mac.yml'), feed([`AGNT-${V}-mac-arm64.zip`, ...(dropIntel ? [] : [`AGNT-${V}-mac-x64.zip`])]));
  fs.writeFileSync(path.join(dir, 'latest-linux.yml'), feed([`AGNT-${V}-linux-x86_64.AppImage`]));
}

describe('release-manifest', () => {
  it('a complete release validates and writes the manifest the server reads', () => {
    writeRelease(tmp);
    const r = run('release-manifest.mjs', ['--tag', `v${V}`, '--dir', tmp]);
    expect(r.status, r.stderr).toBe(0);
    const m = JSON.parse(fs.readFileSync(path.join(tmp, 'release-manifest.json'), 'utf8'));
    expect(validateManifest(m, V)).toEqual([]);
    expect(m.assets).toHaveLength(11);
    expect(m.feeds.mac.files.map((f) => f.name)).toEqual([`AGNT-${V}-mac-arm64.zip`, `AGNT-${V}-mac-x64.zip`]);
  });

  it('THE v0.6.6 DEFECT: a feed pointing at AGNT-Lite is refused', () => {
    writeRelease(tmp, { lite: true });
    const r = run('release-manifest.mjs', ['--tag', `v${V}`, '--dir', tmp]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Lite build/);
    expect(r.stderr).toMatch(/win feed has no Windows installer/);
  });

  it('a release missing the Intel Mac build is refused', () => {
    writeRelease(tmp, { dropIntel: true });
    const r = run('release-manifest.mjs', ['--tag', `v${V}`, '--dir', tmp]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no Intel zip/);
  });

  it('THE v0.6.2-0.6.5 DEFECT: an empty release is refused', () => {
    writeRelease(tmp, { empty: true });
    const r = run('release-manifest.mjs', ['--tag', `v${V}`, '--dir', tmp]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/lists no assets/);
  });

  it('a feed whose hash disagrees with the file is refused', () => {
    writeRelease(tmp);
    fs.appendFileSync(path.join(tmp, `AGNT-${V}-win-x64.exe`), 'tampered');
    const r = run('release-manifest.mjs', ['--tag', `v${V}`, '--dir', tmp]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/win feed sha512 for .* differs/);
  });

  it('feedFromYml keys entries by file name', () => {
    expect(feedFromYml(parseLatestYml(yml([[`AGNT-${V}-win-x64.exe`, 5, 9]]))).files[0]).toMatchObject({ name: `AGNT-${V}-win-x64.exe`, size: 5, blockMapSize: 9 });
  });
});
