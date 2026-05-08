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

class PathManager {
  constructor() {
    const resolved = resolvePaths();
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
          console.error(`Failed to create directory at ${dir}:`, error);
          const tmp = path.join(os.tmpdir(), 'agnt-data');
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
   * Join one or more path segments under the ROOT dir (parent — preserves
   * pre-PRD-060 semantics so projects, mcp.json, _logs/, etc. resolve to
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
