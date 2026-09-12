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

// ─── Test-storage registration gate (v5.2, adversarial F1–F7 resolved) ──
//
// WHAT THIS ACTUALLY DOES (v5.1, matching the code below):
//   • detectStorageMode() returns 'test' (VITEST or NODE_ENV=test) or
//     'production'. There is no escaped mode.
//   • In test mode, requireTestStorage() must find a globalThis registration
//     placed there by the test setup file. This proves the process ran the
//     setup — it does NOT prove who created the registration.
//   • After the registration check, the standard resolvePaths() cascade is
//     used (same as production) so tests can override USER_DATA_PATH for
//     their own scenarios — but requireTestStorage() constrains overrides
//     to subdirectories of the registered root.
//   • AGNT_HOME is rejected. AGNT_TEST_USE_REAL_DATA is rejected.
//   • Auth-switch and secret env vars are scrubbed at every import.
//
// WHAT THIS DOES NOT DO (honest limits):
//   • It does not confine hostile same-uid code that can pre-populate
//     globalThis or control its own environment. The OS boundary
//     (bwrap/namespace in CI and dev scripts) is the actual security layer.
//   • Direct imports that set no NODE_ENV or VITEST run in production mode
//     by design — no claim is made about them.
//   • Cross-process storage sharing is intentionally removed: every process
//     must run its own setup and own its own root. Children that need to
//     share a parent's DB require explicit opt-in outside this module.
//   • TOCTOU between lstat and SQLite open, and hardlinks to real databases,
//     are accepted residuals of in-process enforcement.
//
// There are no claim files, no env nonces, no ancestor attachment — those
// were v4 mechanisms removed in v5. All v5 files that referenced them are
// cleaned up. The registration gate plus database/index.js's pre-probe
// validation are the only storage checks.
const REAL_HOME_DEV_ENV = 'AGNT_TEST_REAL_HOME_DEV';

function explicitStorageError(why, detail = '') {
  return new Error(
    '[explicit-storage] test storage boundary rejected: ' + why +
    (detail ? ' (' + detail + ')' : '') +
    '. Refusing to resolve, create, probe or open any data directory. ' +
    'Test/runner processes require a host-declared root: the host creates a fresh sandbox, ' +
    'exports AGNT_EXPLICIT_DATA_ROOT=<root> (USER_DATA_PATH may mirror it), and lets the first ' +
    'process claim it — or pre-claims it as the spawning ancestor. AGNT_TEST_USE_REAL_DATA is not honored.'
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
      // A registration MUST exist (proves this process ran the test setup,
      // not an accidental import from a script or REPL). But tests may
      // legitimately override USER_DATA_PATH to exercise different
      // install-directory scenarios; we resolve from the current env just
      // like production, after the registration check. The OS boundary —
      // not this module — confines where writes can actually land.
      requireTestStorage(); // throws if no registration for this process
      resolved = resolvePaths(); // same tier cascade as production
      // No claim files or root tracking in v5.1 — the registration on
      // globalThis is the only storage-state this module holds.
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
