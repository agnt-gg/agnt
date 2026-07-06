// Resolve an untrusted target string into a scannable local directory (for code) or a
// validated URL (for web recon). Handles three input kinds:
//   - git URL        → shallow-clone into a sandboxed temp dir
//   - local path      → validate it exists, is a dir, and (by default) is contained
//   - live http(s) URL → validated URL object for the web-recon scanner
//
// SECURITY: the target comes from user input. We never pass it to a shell (run() uses
// shell:false argv). For local paths we resolve + realpath to block traversal games.

import { run, makeTempDir, IS_WIN } from './util.js';
import { statSync, realpathSync, existsSync, readdirSync } from 'fs';
import { resolve as pathResolve, extname, join } from 'path';

const GIT_URL_RE = /^(https?:\/\/|git@)[^\s]+?(\.git|\/)?$/i;
const HTTP_URL_RE = /^https?:\/\/[^\s]+$/i;

export class IngestError extends Error {
  constructor(msg) { super(msg); this.name = 'IngestError'; }
}

/** Classify the raw target string. */
export function classifyTarget(raw) {
  const t = (raw || '').trim();
  if (!t) throw new IngestError('Target is required.');
  // git: github/gitlab/bitbucket http(s), any *.git, or scp-style git@
  if (/^git@/.test(t) || /\.git\/?$/i.test(t) ||
      /^https?:\/\/(www\.)?(github|gitlab|bitbucket)\.com\//i.test(t)) {
    return 'git';
  }
  if (HTTP_URL_RE.test(t)) return 'url';
  // otherwise treat as a local path
  return 'local';
}

/**
 * Resolve the target. Returns:
 *   { kind: 'git'|'local'|'url', dir?: string, url?: string, cleanup?: fn,
 *     repoName?: string, isTemp: boolean }
 * For 'url', dir is undefined and url is the validated address.
 */
export async function ingest(rawTarget, { onProgress } = {}) {
  const kind = classifyTarget(rawTarget);
  const target = rawTarget.trim();
  const log = (m) => onProgress && onProgress(m);

  if (kind === 'url') {
    let u;
    try { u = new URL(target); } catch { throw new IngestError(`Invalid URL: ${target}`); }
    if (!/^https?:$/.test(u.protocol)) throw new IngestError('Only http(s) URLs are supported.');
    return { kind: 'url', url: u.toString(), isTemp: false };
  }

  if (kind === 'git') {
    log(`Cloning ${target} …`);
    const dir = makeTempDir('sentinel-clone-');
    // Shallow clone, no checkout of history depth, no interactive prompts.
    const r = await run('git', [
      '-c', 'core.askPass=',
      '-c', 'credential.helper=',
      'clone', '--depth', '1', '--single-branch', '--no-tags',
      target, dir,
    ], { timeout: 180000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    if (r.code !== 0) {
      throw new IngestError(`git clone failed: ${(r.stderr || r.spawnError || 'unknown error').slice(0, 500)}`);
    }
    const repoName = target.replace(/\.git$/i, '').split('/').filter(Boolean).pop() || 'repo';
    log(`Cloned into sandbox.`);
    return { kind: 'git', dir, repoName, isTemp: true, sourceUrl: target };
  }

  // local
  let abs;
  try {
    abs = realpathSync(pathResolve(target));
  } catch {
    throw new IngestError(`Local path does not exist or is not accessible: ${target}`);
  }
  let st;
  try { st = statSync(abs); } catch { throw new IngestError(`Cannot stat path: ${abs}`); }
  if (!st.isDirectory()) {
    // Allow a single file? For MVP we require a directory (scanners walk trees).
    throw new IngestError(`Path must be a directory (got a file): ${abs}`);
  }
  const repoName = abs.split(/[\\/]/).filter(Boolean).pop() || 'project';
  return { kind: 'local', dir: abs, repoName, isTemp: false };
}

/**
 * Detect languages/ecosystems present in a directory by sampling file extensions and
 * lockfiles. Cheap, non-recursive-deep (bounded walk). Drives which scanners run.
 */
export function detectLanguages(dir, { maxFiles = 4000 } = {}) {
  const extCount = {};
  const markers = new Set();
  let seen = 0;
  const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.venv', 'venv',
    '__pycache__', '.next', 'out', 'coverage', '.cache', 'target', 'bin', 'obj']);

  const walk = (d, depth) => {
    if (seen >= maxFiles || depth > 8) return;
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (seen >= maxFiles) return;
      const name = e.name;
      if (e.isDirectory()) {
        if (IGNORE.has(name) || name.startsWith('.')) continue;
        walk(join(d, name), depth + 1);
      } else {
        seen++;
        const ext = extname(name).toLowerCase();
        if (ext) extCount[ext] = (extCount[ext] || 0) + 1;
        const lower = name.toLowerCase();
        if (lower === 'package.json') markers.add('npm');
        else if (lower === 'requirements.txt' || lower === 'pyproject.toml' || lower === 'pipfile') markers.add('pip');
        else if (lower === 'go.mod') markers.add('go');
        else if (lower === 'cargo.toml') markers.add('cargo');
        else if (lower === 'gemfile') markers.add('bundler');
        else if (lower === 'composer.json') markers.add('composer');
        else if (lower === 'pom.xml' || lower === 'build.gradle') markers.add('maven');
        else if (lower === 'dockerfile' || lower.startsWith('dockerfile')) markers.add('docker');
      }
    }
  };
  walk(dir, 0);

  const langByExt = {
    '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescript',
    '.py': 'python', '.rb': 'ruby', '.go': 'go', '.rs': 'rust', '.php': 'php',
    '.java': 'java', '.kt': 'kotlin', '.cs': 'csharp', '.c': 'c', '.h': 'c',
    '.cpp': 'cpp', '.cc': 'cpp', '.scala': 'scala', '.swift': 'swift',
    '.sh': 'bash', '.yml': 'yaml', '.yaml': 'yaml', '.tf': 'terraform',
    '.sol': 'solidity', '.vue': 'vue', '.html': 'html',
  };
  const langs = {};
  for (const [ext, n] of Object.entries(extCount)) {
    const lang = langByExt[ext];
    if (lang) langs[lang] = (langs[lang] || 0) + n;
  }
  const languages = Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([l]) => l);
  return { languages, ecosystems: [...markers], fileSample: seen, extCount };
}
