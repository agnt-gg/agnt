/**
 * Release tooling shared by the CI scripts in this folder. No dependencies:
 * the release job runs on a bare runner without node_modules.
 *
 * What this exists to prevent, each seen in a shipped release:
 *   - v0.6.6's Intel Mac zip carried arm64 sqlite3 and sharp: one arm64 runner
 *     built both architectures with npmRebuild off.            -> binaryArch()
 *   - v0.6.6's latest.yml and latest-linux.yml named AGNT-Lite files: two
 *     variants wrote one feed and the last writer won.          -> validateManifest()
 *   - v0.6.2 to v0.6.5 were published with zero assets.         -> validateManifest()
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

// ------------------------------------------------------------ latest*.yml
/**
 * Parse the exact latest*.yml shape electron-builder writes (and agnt.gg
 * renders): scalar keys plus one `files:` list of flat maps.
 */
export function parseLatestYml(text) {
  const out = { files: [] };
  let item = null;
  let inFiles = false;
  const scalar = (v) => {
    v = v.trim();
    if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
    if (/^".*"$/.test(v)) return JSON.parse(v);
    if (/^-?\d+$/.test(v)) return Number(v);
    return v;
  };
  for (const raw of String(text).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const listItem = /^\s+-\s+([A-Za-z0-9_]+):\s*(.*)$/.exec(raw);
    const nested = /^\s{2,}([A-Za-z0-9_]+):\s*(.*)$/.exec(raw);
    const top = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(raw);
    if (listItem && inFiles) {
      item = { [listItem[1]]: scalar(listItem[2]) };
      out.files.push(item);
    } else if (nested && inFiles && item) {
      item[nested[1]] = scalar(nested[2]);
    } else if (top) {
      inFiles = top[1] === 'files' && top[2].trim() === '';
      item = null;
      if (!inFiles) out[top[1]] = scalar(top[2]);
    } else {
      throw new Error(`latest.yml: cannot parse line: ${raw}`);
    }
  }
  return out;
}

const q = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** Write the same shape back, in electron-builder's field order. */
export function renderLatestYml(doc) {
  const lines = [`version: ${doc.version}`, 'files:'];
  for (const f of doc.files) {
    lines.push(`  - url: ${f.url}`, `    sha512: ${f.sha512}`, `    size: ${f.size}`);
    if (Number.isInteger(f.blockMapSize)) lines.push(`    blockMapSize: ${f.blockMapSize}`);
  }
  lines.push(`path: ${doc.path}`, `sha512: ${doc.sha512}`, `releaseDate: ${q(doc.releaseDate)}`);
  return lines.join('\n') + '\n';
}

/**
 * One latest-mac.yml from the arm64 and x64 builds, which now run on separate
 * runners and each write their own. Legacy `path` is the x64 zip, as before.
 */
export function mergeMacFeeds(a, b) {
  if (a.version !== b.version) throw new Error(`mac feeds disagree on version: ${a.version} vs ${b.version}`);
  const byUrl = new Map();
  for (const f of [...a.files, ...b.files]) {
    const prev = byUrl.get(f.url);
    if (prev && prev.sha512 !== f.sha512) throw new Error(`mac feeds list ${f.url} with different sha512`);
    byUrl.set(f.url, f);
  }
  const files = [...byUrl.values()].sort((x, y) => x.url.localeCompare(y.url));
  const primary = files.find((f) => /-mac-x64\.zip$/.test(f.url)) || files.find((f) => f.url.endsWith('.zip')) || files[0];
  return {
    version: a.version,
    files,
    path: primary.url,
    sha512: primary.sha512,
    releaseDate: [a.releaseDate, b.releaseDate].filter(Boolean).sort().at(-1),
  };
}

// ------------------------------------------------------------ hashing
export function sha512File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('base64')));
  });
}

// ------------------------------------------------------------ native binaries
/**
 * What a compiled binary was built for, from its header.
 * @returns {{ format: 'pe'|'macho'|'elf'|'fat'|'unknown', arch: string|null }}
 */
export function binaryArch(buf) {
  if (!buf || buf.length < 64) return { format: 'unknown', arch: null };
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    const pe = buf.readUInt32LE(0x3c);
    if (pe + 6 > buf.length || buf.readUInt32LE(pe) !== 0x00004550) return { format: 'pe', arch: null };
    const machine = buf.readUInt16LE(pe + 4);
    return { format: 'pe', arch: { 0x8664: 'x64', 0xaa64: 'arm64', 0x14c: 'ia32' }[machine] || `0x${machine.toString(16)}` };
  }
  if (buf.readUInt32BE(0) === 0xcafebabe) return { format: 'fat', arch: 'universal' };
  if (buf.readUInt32LE(0) === 0xfeedfacf) {
    const cpu = buf.readUInt32LE(4);
    return { format: 'macho', arch: { 0x01000007: 'x64', 0x0100000c: 'arm64' }[cpu] || `0x${cpu.toString(16)}` };
  }
  if (buf.readUInt32BE(0) === 0x7f454c46) {
    const machine = buf.readUInt16LE(18);
    return { format: 'elf', arch: { 62: 'x64', 183: 'arm64' }[machine] || `${machine}` };
  }
  return { format: 'unknown', arch: null };
}

export const EXPECTED_FORMAT = { win: 'pe', mac: 'macho', linux: 'elf' };

/** Does a binary header match the platform and architecture being shipped? */
export function archMatches({ format, arch }, platform, wantArch) {
  if (format === 'fat') return platform === 'mac'; // a universal binary runs on both Macs
  return format === EXPECTED_FORMAT[platform] && arch === wantArch;
}

// ------------------------------------------------------------ zip (local file)
/** Entries of a local zip: { name, method, compressedSize, offset }. Handles zip64. */
export function zipEntries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65536 + 22);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0) throw new Error(`${file}: not a zip`);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOff = tail.readUInt32LE(eocd + 16);
    if (cdOff === 0xffffffff || cdSize === 0xffffffff) {
      const loc = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
      const z64Off = Number(tail.readBigUInt64LE(loc + 8));
      const rec = Buffer.alloc(56);
      fs.readSync(fd, rec, 0, 56, z64Off);
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOff = Number(rec.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const entries = [];
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50; ) {
      const method = cd.readUInt16LE(p + 10);
      let csize = cd.readUInt32LE(p + 20);
      const usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28);
      const xlen = cd.readUInt16LE(p + 30);
      const clen = cd.readUInt16LE(p + 32);
      let off = cd.readUInt32LE(p + 42);
      const name = cd.slice(p + 46, p + 46 + nlen).toString();
      if (csize === 0xffffffff || off === 0xffffffff) {
        const extra = cd.slice(p + 46 + nlen, p + 46 + nlen + xlen);
        for (let e = 0; e + 4 <= extra.length; ) {
          const id = extra.readUInt16LE(e);
          const len = extra.readUInt16LE(e + 2);
          if (id === 1) {
            let r = e + 4;
            if (usize === 0xffffffff) r += 8;
            if (csize === 0xffffffff) { csize = Number(extra.readBigUInt64LE(r)); r += 8; }
            if (off === 0xffffffff) off = Number(extra.readBigUInt64LE(r));
          }
          e += 4 + len;
        }
      }
      entries.push({ name, method, compressedSize: csize, offset: off });
      p += 46 + nlen + xlen + clen;
    }
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

/** The first bytes of one zip entry, decompressed: enough for a binary header. */
export function zipEntryHead(file, entry, bytes = 4096) {
  const fd = fs.openSync(file, 'r');
  try {
    const lh = Buffer.alloc(30);
    fs.readSync(fd, lh, 0, 30, entry.offset);
    const start = entry.offset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
    const want = Math.min(entry.compressedSize, Math.max(bytes, 65536));
    const raw = Buffer.alloc(want);
    fs.readSync(fd, raw, 0, want, start);
    if (entry.method === 0) return raw.subarray(0, bytes);
    try {
      return zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }).subarray(0, bytes);
    } catch {
      return Buffer.alloc(0);
    }
  } finally {
    fs.closeSync(fd);
  }
}

// ------------------------------------------------------------ manifest
/**
 * MUST match agnt-server agnt.gg/update-feed.js validateManifest(). The server
 * re-runs the same rules before it serves a feed; running them here first means
 * a release that would be refused is never published.
 */
export function validateManifest(m, expectedVersion) {
  const problems = [];
  if (!m || typeof m !== 'object') return ['manifest is not an object'];
  const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
  if (m.schema !== 1) problems.push(`unknown manifest schema ${m.schema}`);
  if (m.product !== 'AGNT') problems.push(`product is "${m.product}", expected "AGNT"`);
  if (!SEMVER.test(m.version || '')) problems.push(`version "${m.version}" is not semver`);
  if (expectedVersion && m.version !== expectedVersion) problems.push(`manifest is ${m.version}, expected ${expectedVersion}`);
  if (m.tag !== `v${m.version}`) problems.push(`tag "${m.tag}" does not match version ${m.version}`);

  const prefix = `AGNT-${m.version}-`;
  const assets = new Map();
  for (const a of Array.isArray(m.assets) ? m.assets : []) {
    if (!a || typeof a.name !== 'string') { problems.push('asset without a name'); continue; }
    if (/lite/i.test(a.name)) problems.push(`asset ${a.name} is a Lite build`);
    if (!a.name.startsWith(prefix)) problems.push(`asset ${a.name} is not named ${prefix}*`);
    if (!/^[A-Za-z0-9+/]{86}==$/.test(a.sha512 || '')) problems.push(`asset ${a.name} has no base64 sha512`);
    if (!Number.isInteger(a.size) || a.size <= 0) problems.push(`asset ${a.name} has no size`);
    assets.set(a.name, a);
  }
  if (assets.size === 0) problems.push('manifest lists no assets');

  const feeds = m.feeds || {};
  for (const platform of ['win', 'mac', 'linux']) {
    const feed = feeds[platform];
    if (!feed || !Array.isArray(feed.files) || feed.files.length === 0) { problems.push(`no ${platform} feed`); continue; }
    if (feed.version !== m.version) problems.push(`${platform} feed is ${feed.version}, manifest is ${m.version}`);
    for (const f of feed.files) {
      const asset = assets.get(f.name);
      if (!asset) { problems.push(`${platform} feed lists ${f.name}, which is not an asset`); continue; }
      if (asset.sha512 !== f.sha512) problems.push(`${platform} feed sha512 for ${f.name} differs from the asset`);
      if (asset.size !== f.size) problems.push(`${platform} feed size for ${f.name} differs from the asset`);
    }
  }
  const names = (p) => (feeds[p]?.files || []).map((f) => f.name);
  const need = (p, suffix, what) => {
    if (!names(p).some((n) => n === `${prefix}${suffix}`)) problems.push(`${p} feed has no ${what} (${prefix}${suffix})`);
  };
  need('win', 'win-x64.exe', 'Windows installer');
  need('mac', 'mac-arm64.zip', 'Apple Silicon zip');
  need('mac', 'mac-x64.zip', 'Intel zip');
  need('linux', 'linux-x86_64.AppImage', 'AppImage');
  for (const n of [...names('win'), ...names('mac')].filter((x) => /\.(exe|zip)$/.test(x))) {
    if (!assets.has(`${n}.blockmap`)) problems.push(`missing ${n}.blockmap`);
  }
  return problems;
}

/** A feed entry from a latest*.yml, keyed by file NAME (urls there are bare names). */
export function feedFromYml(doc) {
  return {
    version: String(doc.version),
    releaseDate: doc.releaseDate,
    files: doc.files.map((f) => ({
      name: String(f.url).split('/').pop(),
      sha512: f.sha512,
      size: f.size,
      ...(Number.isInteger(f.blockMapSize) ? { blockMapSize: f.blockMapSize } : {}),
    })),
  };
}
