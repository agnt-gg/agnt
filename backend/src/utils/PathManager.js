import { requireTestStorage } from './testStorageContext.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve AGNT's writable directories using a single four-tier cascade.
 * Returns BOTH a rootDir (parent — for config-style files like mcp.json,
 * code-settings.json, projects/, _logs/) AND a dataDir (subdir — for runtime
 * data like agnt.db, images/, uploads/, caches).
 *
 * The split exists because Electron has historically used two folders:
 *   %APPDATA%/AGNT/         <-- rootDir (mcp.json, projects, _logs, cookies, schema cache, embeddings)
 *   %APPDATA%/AGNT/Data/    <-- dataDir (agnt.db, images, uploads, transformers-cache)
 *
 * In every other deployment mode (Docker, AGNT_HOME, homedir, cwd) rootDir
 * and dataDir collapse to the same path — there's no reason to split them
 * when there's only one mounted volume / one home dir to work with.
 *
 * Tiers, in order:
 *   1. Docker        — Linux container with /app/data mounted (NEVER fires on win32)
 *                      rootDir = dataDir = /app/data
 *   2. Electron      — USER_DATA_PATH set by main.js
 *                      rootDir = USER_DATA_PATH; dataDir = USER_DATA_PATH/Data
 *   3. AGNT_HOME     — explicit user override
 *                      rootDir = dataDir = AGNT_HOME/.agnt/data
 *   4. homedir       — default
 *                      rootDir = dataDir = ~/.agnt/data
 *   5. cwd fallback  — CI / weird envs only
 *                      rootDir = dataDir = cwd/data
 *
 * TEST MODE (VITEST / NODE_ENV=test) uses NONE of these tiers: storage is
 * resolved exclusively from the admitted storage context (D1) — see the
 * registration gate below and backend/src/utils/testStorageContext.js.
 */
const resolvePaths = () => {
  if (
    process.env.NODE_ENV === 'production' &&
    process.platform !== 'win32' &&
    fs.existsSync('/app/data')
  ) {
    return { rootDir: '/app/data', dataDir: '/app/data', source: 'docker' };
  }
  if (process.env.USER_DATA_PATH) {
    return {
      rootDir: process.env.USER_DATA_PATH,
      dataDir: path.join(process.env.USER_DATA_PATH, 'Data'),
      source: 'electron',
    };
  }
  if (process.env.AGNT_HOME) {
    const collapsed = path.join(process.env.AGNT_HOME, '.agnt', 'data');
    return { rootDir: collapsed, dataDir: collapsed, source: 'agnt_home' };
  }
  const home = os.homedir();
  if (home) {
    const collapsed = path.join(home, '.agnt', 'data');
    return { rootDir: collapsed, dataDir: collapsed, source: 'homedir' };
  }
  const cwdData = path.resolve(process.cwd(), 'data');
  return { rootDir: cwdData, dataDir: cwdData, source: 'cwd' };
};

// ─── Test-storage resolution gate (v6.0, PR145 A1 D1) ─────────────────────
//
// WHAT THIS ACTUALLY DOES (v6.0, matching the code below):
//   • detectStorageMode() returns 'test' (VITEST or NODE_ENV=test) or
//     'production'. There is no escaped mode.
//   • In TEST mode this module reads NO environment variable at all: the
//     root comes exclusively from the validated storage context
//     (requireTestStorage() → rootDir = ctx.root, dataDir = ctx.root/Data).
//     USER_DATA_PATH / AGNT_HOME / TMPDIR / HOME mutations after setup are
//     inert to resolution (S3/R04). The explicit override API is
//     admitTestRoot() in testStorageContext.js — never an env var.
//   • Validation strictly precedes creation: requireTestStorage() validates
//     the registration (structural shape, pid, frozen admitted-parent
//     anchor, ancestor walk — every component lstat'd as a plain directory,
//     not a symlink, realpath === lexical — and root dev/ino identity)
//     BEFORE this constructor runs any mkdir; only then are missing
//     interior directories created.
//   • Production behaviour is byte-identical to the original cascade: the
//     same five tiers, the same tmp-fallback, the same logs. Nothing in
//     the production branch reads the storage context.
//
// WHAT THIS DOES NOT DO (honest limits):
//   • It does not confine hostile same-uid code that can pre-populate
//     globalThis or control its own environment. The OS boundary
//     (bwrap/namespace in CI and dev scripts) is the actual security layer.
//   • Direct imports that set no NODE_ENV or VITEST run in production mode
//     by design — no claim is made about them.
//   • Cross-process storage sharing is intentionally not provided here:
//     every process runs its own setup and owns its own root (the explicit
//     shared-store child contract is Stage C).
//   • TOCTOU between validation and the SQLite open remains a documented
//     trusted-mode residual: database/index.js revalidates the dbDir
//     identity after its write probe (D5), and enforced-mode containment
//     is Stage D. Race-safety is never claimed for trusted mode.
//
// The dead REAL_HOME_DEV_ENV constant (written in v4, never read anywhere)
// is deleted (D13); so is the AGNT_EXPLICIT_DATA_ROOT guidance from the
// error text — the override API it described never existed.

function explicitStorageError(why, detail = '') {
  return new Error(
    '[explicit-storage] test storage boundary rejected: ' + why +
    (detail ? ' (' + detail + ')' : '') +
    '. Refusing to resolve, create, probe or open any data directory. ' +
    'Test/runner processes require an admitted storage context: the trusted setup ' +
    '(tests/setup/isolate-data-dir.mjs) calls initializeTestStorage(), and a fixture ' +
    'overrides the ACTIVE root only via admitTestRoot() from testStorageContext.js. ' +
    'AGNT_TEST_USE_REAL_DATA is not honored.'
  );
}

/**
 * 'test'       — a test/runner context (vitest worker or NODE_ENV=test).
 * 'production' — everything else; behaviour is byte-identical to the
 *                original cascade and the documented production launch
 *                contract applies.
 * There is no 'escaped' mode. Direct imports that set neither VITEST nor
 * NODE_ENV=test are production by definition; env detection does not claim
 * to catch them (see CONTRACT.md).
 */
export function detectStorageMode(env = process.env) {
  if (env.VITEST || env.NODE_ENV === 'test') return 'test';
  return 'production';
}

function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}


class PathManager {
  constructor() {
    const storageMode = detectStorageMode();
    this.storageMode = storageMode;

    let resolved;
    if (storageMode === 'test') {
      // D1 (v6.0): test mode resolves ONLY from the validated storage
      // context — ZERO environment reads. requireTestStorage() throws a
      // typed error unless this process has a valid admitted registration
      // (it also refuses the AGNT_HOME / AGNT_TEST_USE_REAL_DATA
      // misconfiguration signals), and its validation — structural shape,
      // pid, frozen admitted-parent anchor, ancestor walk (each component
      // lstat'd as a plain directory, not a symlink, realpath === lexical)
      // and root dev/ino identity — runs BEFORE the mkdir loop below:
      // validation strictly precedes any creating effect.
      const admitted = requireTestStorage();
      resolved = {
        rootDir: admitted.root,
        dataDir: path.join(admitted.root, 'Data'),
        source: 'test-context',
      };
      this.storageMode = 'test-registered';
    } else {
      resolved = resolvePaths();
    }
    this.rootDir = resolved.rootDir;
    this.dataDir = resolved.dataDir;
    this.source = resolved.source;
    // One-shot startup log so the next contributor / Codex / support thread
    // can see immediately which tier won and (if Electron) that two folders
    // are in play.
    if (this.rootDir === this.dataDir) {
      console.log(`📁 AGNT data: ${this.dataDir} (source: ${this.source})`);
    } else {
      console.log(`📁 AGNT root: ${this.rootDir}`);
      console.log(`📁 AGNT data: ${this.dataDir} (source: ${this.source})`);
    }

    // Ensure both dirs exist; fall back to a temp dir if creation fails.
    for (const dir of [this.rootDir, this.dataDir]) {
      if (!fs.existsSync(dir)) {
        try {
          fs.mkdirSync(dir, { recursive: true });
        } catch (error) {
          if (storageMode === 'test') {
            // Fail closed: the historical shared tmp-fallback (/tmp/agnt-data)
            // is a cross-instance boundary a test must never accept.
            throw explicitStorageError('cannot create the declared data directory', dir + ': ' + error.message);
          }
          console.error(`Failed to create directory at ${dir}:`, error);          const tmp = path.join(os.tmpdir(), 'agnt-data');
          if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
          this.rootDir = tmp;
          this.dataDir = tmp;
          this.source = 'tmp-fallback';
          console.warn(`📁 AGNT data: ${tmp} (source: tmp-fallback)`);
          break;
        }
      }
    }

    // Backward-compat: existing callers expect userDataPath to behave the
    // same as today, which is the rootDir (parent — pre-PRD-060 semantics).
    this.userDataPath = this.rootDir;

    // Source root (read-only assets — backend code, bundled prompts, etc.).
    this.backendRoot = path.resolve(__dirname, '../../');
  }

  /**
   * Parent user-data directory. On Electron this is %APPDATA%/AGNT;
   * on every other mode it equals getDataDir(). Use this for config-style
   * files (mcp.json, code-settings.json, projects/, _logs/, cookies, schema
   * caches, embeddings).
   * @returns {string}
   */
  getRootDir() {
    return this.rootDir;
  }

  /**
   * Runtime data subdirectory. On Electron this is %APPDATA%/AGNT/Data;
   * on every other mode it equals getRootDir(). Use this for files where
   * runtime separation from config matters historically: agnt.db, images/,
   * uploads/, transformers-cache, client-versions cache.
   * @returns {string}
   */
  getDataDir() {
    return this.dataDir;
  }

  /**
   * Backward-compatible alias for getRootDir(). Keep using this from
   * legacy call sites — pre-PRD-060 callers expect rootDir semantics.
   * @returns {string}
   */
  getUserDataPath() {
    return this.rootDir;
  }

  /**
   * Which tier of the cascade resolved the paths.
   * @returns {'docker'|'electron'|'agnt_home'|'homedir'|'cwd'|'tmp-fallback'}
   */
  getDataDirSource() {
    return this.source;
  }

  /**
   * Storage mode resolved at construction: 'test' | 'production'.
   * @returns {'test'|'production'}
   */
  getStorageMode() {
    return this.storageMode;
  }

  /**
   * Frozen snapshot of the tier resolution — for launch receipts,
   * boundary-status surfaces and tests. Read-only.
   */
  getResolution() {
    return {
      rootDir: this.rootDir,
      dataDir: this.dataDir,
      source: this.source,
      storageMode: this.storageMode,
    };
  }

  /**
   * Join one or more path segments under the ROOT dir (parent — preserves   * pre-PRD-060 semantics so projects, mcp.json, _logs/, etc. resolve to
   * their original on-disk locations).
   * @param {...string} parts
   * @returns {string}
   */
  getPath(...parts) {
    return path.join(this.rootDir, ...parts);
  }

  /**
   * Join one or more path segments under the DATA dir (runtime subfolder
   * on Electron, collapsed to root in every other mode).
   * @param {...string} parts
   * @returns {string}
   */
  getDataPath(...parts) {
    return path.join(this.dataDir, ...parts);
  }

  /**
   * Path to a read-only source asset (relative to backend root).
   * @param {...string} parts
   * @returns {string}
   */
  getSourcePath(...parts) {
    return path.join(this.backendRoot, ...parts);
  }

  /**
   * Copy a bundled file into user data on first run if it's missing.
   * Uses rootDir to preserve the historical config-file location.
   * @param {string} relativePath
   */
  async ensureFile(relativePath) {
    const targetPath = this.getPath(relativePath);
    if (!fs.existsSync(targetPath)) {
      const sourcePath = this.getSourcePath(relativePath);
      if (fs.existsSync(sourcePath)) {
        try {
          const targetDir = path.dirname(targetPath);
          if (!fs.existsSync(targetDir)) {
            await fs.promises.mkdir(targetDir, { recursive: true });
          }
          await fs.promises.copyFile(sourcePath, targetPath);
          console.log(`Initialized ${relativePath} in user data.`);
        } catch (error) {
          console.error(`Failed to copy ${relativePath} to user data:`, error);
        }
      }
    }
    return targetPath;
  }
}

export default new PathManager();
