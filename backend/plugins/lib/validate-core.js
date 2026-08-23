/**
 * AGNT Plugin Validation Core — trust system
 *
 * THE single shared validation core (the "one core, many callers" rule from
 * trust system). Every rule about what makes a plugin package valid is
 * written HERE and only here. Callers:
 *
 *   - backend/plugins/cli/build-plugin.js        (build gate — hard-fails a build)
 *   - backend/src/plugins/PluginInstaller.js (staged install — validates before swap)
 *   - future: doctor.js, server-side publish gate (trust system / 0.7.0)
 *
 * Design rules:
 *   - NO side effects. Never runs npm install, never mutates the target dir,
 *     never touches the registry. Pure read + report.
 *   - NO hard boot dependencies. `tar` is imported lazily inside the two
 *     functions that need it, so importing this module costs nothing at
 *     server startup and cannot break boot if tar is missing.
 *   - Deterministic only. No LLM calls anywhere (trust system: the deterministic
 *     pass is the only local gate; LLM passes are 0.7.0 server-side work).
 */

import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Manifest / directory validation (the NeuralForge-class checks)
// ---------------------------------------------------------------------------

function resolveContainedManifestPath(rootDir, manifestPath) {
  const raw = String(manifestPath || '').trim();
  if (!raw || path.isAbsolute(raw) || path.win32.isAbsolute(raw)) return null;

  const root = path.resolve(rootDir);
  const target = path.resolve(root, raw.replace(/^\.([/\\])/, ''));
  if (target === root || !target.startsWith(`${root}${path.sep}`)) return null;
  return target;
}

/**
 * Validate an extracted plugin directory: manifest shape, declared tools'
 * entryPoint files, and ecosystem asset files.
 *
 * assetFileMode controls how a MISSING ecosystem-asset file (a declared
 * agent/workflow/skill/widget whose file isn't in the package) is treated:
 *   - 'error' (default): hard-fail. Used by the BUILD gate and the SERVER
 *     PUBLISH gate — authors must ship what they declare.
 *   - 'warn': record it in assetWarnings and stay valid. Used by the
 *     INSTALL / update / inspect path so pre-existing packages with a
 *     dangling ecosystem reference still install (matching the historical
 *     installer, which only ever hard-checked tool entryPoints). The missing
 *     asset is skipped by the loader exactly as before; the trust badge is
 *     capped at 'unverified' to surface it.
 *
 * Tool entryPoints ALWAYS hard-fail on a missing file in every mode — the
 * old installer rejected those too (the NeuralForge class).
 *
 * @param {string} dir - absolute path to an extracted/staged plugin directory
 * @param {{assetFileMode?: 'error'|'warn'}} [opts]
 * @returns {Promise<{valid: boolean, errors: string[], warnings: string[], assetWarnings: string[], manifest: object|null}>}
 */
export async function validateManifestAssets(dir, opts = {}) {
  const assetFileMode = opts.assetFileMode === 'warn' ? 'warn' : 'error';
  const errors = [];
  const warnings = [];
  const assetWarnings = [];
  let manifest = null;

  const manifestPath = path.join(dir, 'manifest.json');
  try {
    manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf-8'));
  } catch (err) {
    errors.push(
      err.code === 'ENOENT'
        ? 'manifest.json not found'
        : `manifest.json unreadable/unparsable: ${err.message}`
    );
    return { valid: false, errors, warnings, assetWarnings, manifest: null };
  }

  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];

  // ecosystem assets: ecosystem plugins may carry agents/workflows/skills/widgets and
  // no tools. Reject only if NOTHING is declared.
  const hasAnyAsset =
    tools.length > 0 ||
    (Array.isArray(manifest.agents) && manifest.agents.length > 0) ||
    (Array.isArray(manifest.workflows) && manifest.workflows.length > 0) ||
    (Array.isArray(manifest.skills) && manifest.skills.length > 0) ||
    (Array.isArray(manifest.widgets) && manifest.widgets.length > 0);
  if (!hasAnyAsset) {
    errors.push('manifest declares no tools/agents/workflows/skills/widgets');
  }

  // Tools: type + entryPoint required; entryPoint file must exist on disk.
  // (This is the exact check whose absence shipped the broken NeuralForge
  // package — see trust system)
  if (manifest.tools && !Array.isArray(manifest.tools)) {
    errors.push('manifest.tools must be an array');
  }
  for (const tool of tools) {
    if (!tool.type) {
      errors.push(`tool entry missing required "type": ${JSON.stringify(tool)}`);
      continue;
    }
    if (!tool.entryPoint) {
      errors.push(`tool "${tool.type}" missing required "entryPoint"`);
      continue;
    }
    const abs = resolveContainedManifestPath(dir, tool.entryPoint);
    if (!abs) {
      errors.push(`tool "${tool.type}" references unsafe path: ${tool.entryPoint}`);
    } else if (!fs.existsSync(abs)) {
      errors.push(`tool "${tool.type}" references missing file: ${tool.entryPoint}`);
    }
    if (!tool.schema || typeof tool.schema !== 'object') {
      warnings.push(
        `tool "${tool.type}" has no schema — install will succeed but the orchestrator won't surface it`
      );
    }
  }

  // ecosystem assets ecosystem asset arrays: slug + file key required; file must exist.
  const assetChecks = [
    { arr: manifest.agents, kind: 'agents', fileKey: 'definition' },
    { arr: manifest.workflows, kind: 'workflows', fileKey: 'definition' },
    { arr: manifest.skills, kind: 'skills', fileKey: 'source' },
    { arr: manifest.widgets, kind: 'widgets', fileKey: 'definition' },
  ];
  for (const { arr, kind, fileKey } of assetChecks) {
    if (arr === undefined || arr === null) continue;
    if (!Array.isArray(arr)) {
      errors.push(`manifest.${kind} must be an array`);
      continue;
    }
    for (const entry of arr) {
      if (!entry?.slug) {
        errors.push(`${kind} entry missing required "slug": ${JSON.stringify(entry)}`);
        continue;
      }
      const rel = entry[fileKey];
      if (!rel) {
        errors.push(`${kind} entry "${entry.slug}" missing required "${fileKey}"`);
        continue;
      }
      const abs = resolveContainedManifestPath(dir, rel);
      if (!abs) {
        errors.push(`${kind} entry "${entry.slug}" references unsafe path: ${rel}`);
      } else if (!fs.existsSync(abs)) {
        // A MISSING ecosystem-asset file: hard error at build/publish, but a
        // tolerated warning at install (the old installer skipped it).
        const msg = `${kind} entry "${entry.slug}" references missing file: ${rel}`;
        if (assetFileMode === 'warn') assetWarnings.push(msg);
        else errors.push(msg);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings, assetWarnings, manifest };
}

// ---------------------------------------------------------------------------
// Integrity (Layer 2) — SRI sha256, the npm-compatible format (trust system)
// ---------------------------------------------------------------------------

/**
 * Compute the SRI integrity string (`sha256-<base64>`) of a file.
 * Streams — safe for multi-MB .agnt archives.
 */
export function computeIntegrity(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(`sha256-${hash.digest('base64')}`));
  });
}
/**
 * Compute a deterministic SRI-style content hash of a directory's
 * FIRST-PARTY files (skips node_modules/dot-dirs — same scope as the
 * capability scan). Used for TOFU drift-detection on plugins whose
 * original archive is no longer available (pre-existing installs).
 */
export async function computeDirIntegrity(dir) {
  const files = [];
  async function walk(current) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SCAN_SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(path.relative(dir, full).replace(/\\/g, '/'));
    }
  }
  await walk(dir);
  files.sort();
  const hash = crypto.createHash('sha256');
  for (const rel of files) {
    hash.update(rel);
    hash.update(Buffer.from([0]));
    hash.update(await fsp.readFile(path.join(dir, rel)));
  }
  return `sha256-${hash.digest('base64')}`;
}


/** Constant-time-ish comparison of two SRI strings (format-normalized). */
export function integrityMatches(expected, actual) {
  if (!expected || !actual) return false;
  const a = Buffer.from(String(expected).trim());
  const b = Buffer.from(String(actual).trim());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Archive verification (post-build gate)
// ---------------------------------------------------------------------------

/**
 * List a .agnt/.tar.gz archive and confirm it is readable and contains a
 * manifest.json (at the top level or under a single prefix directory).
 * Lazy-imports `tar` — no boot-time dependency.
 */
export async function verifyArchive(archivePath) {
  try {
    const tar = await import('tar');
    const entries = [];
    await tar.list({
      file: archivePath,
      onentry: (entry) => entries.push(entry.path),
    });
    const hasManifest = entries.some((p) => {
      const parts = String(p).replace(/\\/g, '/').split('/').filter(Boolean);
      return (
        parts[parts.length - 1] === 'manifest.json' && parts.length <= 2
      );
    });
    if (!hasManifest) {
      return {
        valid: false,
        entries,
        error: 'archive contains no manifest.json at top level or under its prefix directory',
      };
    }
    return { valid: true, entries, error: null };
  } catch (err) {
    return { valid: false, entries: [], error: `archive unreadable: ${err.message}` };
  }
}

/**
 * Dry-run install: extract the archive to a throwaway temp dir, run the same
 * directory validation the installer runs, clean up, return the report.
 * Never touches the real plugins dir. Lazy-imports `tar`.
 */
export async function dryRunInstall(archivePath) {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-dryrun-'));
  try {
    const tar = await import('tar');
    await tar.extract({ file: archivePath, cwd: tmpDir, strip: 1 });
    const report = await validateManifestAssets(tmpDir);
    return report;
  } catch (err) {
    return { valid: false, errors: [`dry-run extraction failed: ${err.message}`], warnings: [], manifest: null };
  } finally {
    try {
      await fsp.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Capability scan (Layer 1) — deterministic pass ONLY.
// Scope: first-party plugin source only. Bundled node_modules are covered by
// the Layer 2 integrity hash, NOT capability-scanned (trust system decision #0).
// This is disclosure-grade static detection: it keeps honest plugins honest
// and drives the badge. It is NOT a security boundary (that is the planned plugin sandbox).
// ---------------------------------------------------------------------------

const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', '.npm-cache', '.DS_Store', 'test-fixtures']);
const SCAN_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);
const SCAN_MAX_FILE_BYTES = 1024 * 1024; // skip pathological single files > 1 MB

/**
 * Capability detectors. Each maps a capability name (trust system Layer 1
 * taxonomy) to regexes evaluated per line of first-party source.
 * Deliberately regex-based (not full AST): deterministic, dependency-free,
 * warn-grade. False positives are acceptable at this tier — the 90-day
 * migration window absorbs them (trust system).
 */
const CAPABILITY_DETECTORS = {
  // `node:child_process` must be detected exactly like `child_process`. The
  // prefixed specifier is the modern spelling of the SAME builtin, and the
  // filesystem detectors below already accept both forms — so a plugin writing
  // `import { execFile } from 'node:child_process'` disclosed nothing while the
  // identical unprefixed import disclosed spawn-process.
  //
  // The two call-shape patterns did not cover it either: execFile/spawn/exec
  // only match when the first argument is a quoted literal, which it is not
  // when the binary comes from a variable or env var.
  'spawn-process': [
    /\brequire\s*\(\s*['"](?:child_process|node:child_process)['"]\s*\)/,
    /\bfrom\s+['"](?:child_process|node:child_process)['"]/,
    /\bimport\s*\(\s*['"](?:child_process|node:child_process)['"]\s*\)/,
    /\b(?:execSync|spawnSync|execFileSync)\s*\(/,
    /\b(?:spawn|exec|execFile|fork)\s*\(\s*['"`]/,
  ],
  network: [
    /\bfetch\s*\(/,
    /\bfrom\s+['"](?:https?|node:https?|axios|undici|node-fetch|got|ws)['"]/,
    /\brequire\s*\(\s*['"](?:https?|node:https?|axios|undici|node-fetch|got|ws)['"]\s*\)/,
    /\bhttps?\.(?:request|get)\s*\(/,
    /\bnew\s+WebSocket\s*\(/,
    /\bnet\.(?:connect|createConnection|Socket)\b/,
  ],
  filesystem: [
    /\bfrom\s+['"](?:fs|node:fs|fs\/promises|node:fs\/promises|fs-extra)['"]/,
    /\brequire\s*\(\s*['"](?:fs|node:fs|fs\/promises|node:fs\/promises|fs-extra)['"]\s*\)/,
    /\bfs\.(?:writeFile|appendFile|mkdir|rm|rmdir|unlink|rename|createWriteStream|copyFile)\w*\s*\(/,
  ],
  'env-access': [/\bprocess\.env\b/],
  'dynamic-eval': [/\beval\s*\(/, /\bnew\s+Function\s*\(/],
  'dynamic-import': [
    // dynamic import with a NON-literal argument (variable/template) —
    // literal dynamic imports are just lazy loading and not flagged.
    /\bimport\s*\(\s*(?!['"])[^)]/,
  ],
};

/**
 * Scan first-party plugin source for capability usage.
 *
 * @param {string} dir - plugin directory (extracted or staged)
 * @returns {Promise<{capabilities: Object<string, Array<{file:string,line:number,snippet:string}>>, filesScanned: number, scanFailed: boolean, error: string|null}>}
 */
export async function scanCapabilities(dir) {
  const capabilities = {};
  let filesScanned = 0;

  async function walk(current) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SCAN_SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!SCAN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

      let content;
      try {
        const stat = await fsp.stat(full);
        if (stat.size > SCAN_MAX_FILE_BYTES) continue;
        content = await fsp.readFile(full, 'utf-8');
      } catch {
        continue;
      }
      filesScanned++;

      const rel = path.relative(dir, full).replace(/\\/g, '/');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Cheap comment skip — full-line comments only. Inline comments and
        // string literals can still false-positive; acceptable at warn grade.
        const trimmed = line.trimStart();
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        for (const [cap, patterns] of Object.entries(CAPABILITY_DETECTORS)) {
          if (capabilities[cap]?.some((hit) => hit.file === rel && hit.line === i + 1)) continue;
          for (const re of patterns) {
            if (re.test(line)) {
              (capabilities[cap] ||= []).push({
                file: rel,
                line: i + 1,
                snippet: line.trim().slice(0, 120),
              });
              break;
            }
          }
        }
      }
    }
  }

  try {
    await walk(dir);
    return { capabilities, filesScanned, scanFailed: false, error: null };
  } catch (err) {
    return { capabilities, filesScanned, scanFailed: true, error: err.message };
  }
}

/**
 * Normalize a manifest `permissions` block to a flat, sorted string array.
 * Accepted shapes:
 *   permissions: ["network", "filesystem"]
 *   permissions: { capabilities: ["network"], domains: ["api.example.com"] }
 * Domains normalize to "domain:<host>".
 */
export function normalizePermissions(permissions) {
  if (!permissions) return [];
  const out = new Set();
  if (Array.isArray(permissions)) {
    for (const p of permissions) if (typeof p === 'string' && p.trim()) out.add(p.trim());
  } else if (typeof permissions === 'object') {
    for (const c of permissions.capabilities || []) {
      if (typeof c === 'string' && c.trim()) out.add(c.trim());
    }
    for (const d of permissions.domains || []) {
      if (typeof d === 'string' && d.trim()) out.add(`domain:${d.trim()}`);
    }
  }
  return [...out].sort();
}

/**
 * Diff declared permissions against scan-detected capabilities.
 * @returns {{undeclared: string[], declaredUnused: string[]}}
 */
export function diffCapabilities(declaredPermissions, detectedCapabilities) {
  const declared = new Set(normalizePermissions(declaredPermissions));
  const detected = Object.keys(detectedCapabilities || {});
  const undeclared = detected.filter((cap) => !declared.has(cap));
  const declaredUnused = [...declared].filter(
    (cap) => !cap.startsWith('domain:') && !detected.includes(cap)
  );
  return { undeclared, declaredUnused };
}

/**
 * The permission set a plugin is actually held to.
 *
 * DECLARING IS OPTIONAL, AND OMITTING IT BUYS NO EXEMPTION. The scan is
 * authoritative for what the code demonstrably does; the declaration adds what
 * the scan cannot see. Neither alone is sufficient, so the effective set is
 * their union:
 *
 *   scan-only    misses capabilities reached through a bundled dependency —
 *                node_modules is in SCAN_SKIP_DIRS — and cannot express
 *                intent-only entries such as domain:api.example.com.
 *   declare-only was the status quo, and it made the update consent gate
 *                inert for any author who simply left the block out. Measured
 *                2026-07-29: 17 of 18 published plugins declared nothing while
 *                the scanner detected spawn-process, network, filesystem and
 *                env-access across 13 of them. Omitting the declaration was a
 *                permanent exemption from re-consent.
 *
 * Under the union, an undeclared capability is granted, disclosed and gated
 * exactly like a declared one, so there is nothing left to gain by omitting it.
 */
export function effectivePermissions(declaredPermissions, detectedCapabilities) {
  const effective = new Set(normalizePermissions(declaredPermissions));
  for (const capability of Object.keys(detectedCapabilities || {})) effective.add(capability);
  return [...effective].sort();
}

// ---------------------------------------------------------------------------
// Trust tier (Layer 6, 0.6.0 display-only ladder — trust system)
//   community  (🔵) integrity recorded + permissions declared + nothing undeclared
//   unverified (🟡) integrity recorded, but declarations incomplete/absent
//   unaudited  (🔴) no integrity, or the scan itself failed
// NOTE: a plugin's tier NEVER affects whether it loads. Display only.
// ---------------------------------------------------------------------------

export function computeTrustTier({ integrityState, permissionsDeclared, undeclaredCount, scanFailed }) {
  if (scanFailed) return 'unaudited';
  if (integrityState !== 'verified' && integrityState !== 'tofu') return 'unaudited';
  // trust system: 🔵 Community = integrity-verified + ALL detected
  // capabilities declared. Vacuously true when the scan detects nothing —
  // a plugin that needs no capabilities shouldn't need a permissions block
  // to earn the tier. (permissionsDeclared is kept in the signature for
  // callers/telemetry but no longer gates the tier by itself.)
  void permissionsDeclared;
  if (undeclaredCount === 0) return 'community';
  return 'unverified';
}

// ---------------------------------------------------------------------------
// Version comparison (Layer 3)
//
// Strict, dependency-free semver comparator. Non-semver registry values —
// 'local', 'latest', 'unknown' all exist in real registries — parse to null
// and surface as "unknown version": never compared, never crashed on, never
// auto-updated over (trust system gotcha 5).
//
// Deliberate deviation from the PRD's named `semver` npm package: importing a
// new runtime dependency into the installer would add a hard server-boot
// dependency and an Electron-packaging change. This comparator covers the
// exact comparison the update checker needs; swapping to the npm package
// later is a 5-line change inside this one function.
// ---------------------------------------------------------------------------

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parse a strict semver string. Returns null for anything non-semver. */
export function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const m = SEMVER_RE.exec(value.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
  };
}

/** semver-spec prerelease identifier comparison. */
function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // release > prerelease
  if (b.length === 0) return -1;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1; // shorter prerelease is lower
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (Number(x) !== Number(y)) return Number(x) < Number(y) ? -1 : 1;
    } else if (xn) {
      return -1; // numeric identifiers are lower than alphanumeric
    } else if (yn) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/**
 * Compare two version strings.
 * @returns {{comparable: boolean, cmp: number|null, reason: string|null}}
 *   comparable=false → at least one side is non-semver ("unknown version").
 *   cmp: -1 (a<b), 0, 1 — only when comparable.
 */
export function compareVersions(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    return {
      comparable: false,
      cmp: null,
      reason: `unknown version (${!pa ? `installed: "${a}"` : `latest: "${b}"`} is not semver)`,
    };
  }
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) {
      return { comparable: true, cmp: pa[key] < pb[key] ? -1 : 1, reason: null };
    }
  }
  const pre = comparePrerelease(pa.prerelease, pb.prerelease);
  return { comparable: true, cmp: pre === 0 ? 0 : pre, reason: null };
}

export default {
  validateManifestAssets,
  computeIntegrity,
  integrityMatches,
  computeDirIntegrity,
  verifyArchive,
  dryRunInstall,
  scanCapabilities,
  normalizePermissions,
  diffCapabilities,
  effectivePermissions,
  computeTrustTier,
  parseSemver,
  compareVersions,
};
