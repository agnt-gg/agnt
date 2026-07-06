import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * PATH augmentation for spawned child processes.
 *
 * Problem: on macOS (and some Linux setups), a process launched from a GUI
 * app, launchd, or a service manager inherits a minimal PATH of only
 * `/usr/bin:/bin:/usr/sbin:/sbin`. Any tool the user installed via Homebrew,
 * npm -g, pipx, or a node version manager (`codex`, `node`, `python3`, etc.)
 * is invisible to children spawned by the AGNT backend — `which codex`
 * returns nothing even though the binary exists at `~/.local/bin/codex`.
 *
 * This also breaks tools we resolve by absolute path: an npm-installed
 * `codex` is a JS script with a `#!/usr/bin/env node` shebang, so launching
 * it still requires `node` to be discoverable on the child's PATH.
 *
 * Fix: prepend well-known user tool directories that actually exist on disk
 * to the PATH handed to child processes. Windows is a no-op — the desktop
 * process there already inherits the full user environment.
 */

/**
 * Find the `<version>/<binSubpath>` directory for the newest installed
 * version under a node-version-manager root (nvm/fnm/asdf layout).
 */
function findLatestVersionBin(baseDir, binSubpath) {
  try {
    if (!fs.existsSync(baseDir)) return null;
    const versions = fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    for (let i = versions.length - 1; i >= 0; i -= 1) {
      const candidate = path.join(baseDir, versions[i], binSubpath);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // Unreadable directory — treat as absent.
  }
  return null;
}

/**
 * Returns `basePath` with common user tool directories prepended (POSIX
 * only). Directories are added only if they exist and aren't already on the
 * PATH, so a healthy login-shell PATH passes through unchanged.
 *
 * @param {string} [basePath] - PATH value to augment. Defaults to process.env.PATH.
 * @returns {string} The augmented PATH (or the input unchanged on Windows).
 */
export function getAugmentedPath(basePath = process.env.PATH || '') {
  if (process.platform === 'win32') return basePath;

  const home = os.homedir();
  const candidates = [
    // Directory of the node binary running this server — guarantees `node`
    // is resolvable by children (fixes `#!/usr/bin/env node` shebangs).
    path.dirname(process.execPath),
    path.join(home, '.local', 'bin'), // pipx, uv, npm prefix, codex installer
    '/opt/homebrew/bin', // Homebrew on Apple Silicon
    '/usr/local/bin', // Homebrew on Intel macs, classic unix local installs
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.volta', 'bin'),
    findLatestVersionBin(path.join(home, '.nvm', 'versions', 'node'), 'bin'),
    findLatestVersionBin(path.join(home, '.fnm', 'node-versions'), path.join('installation', 'bin')),
    findLatestVersionBin(path.join(home, '.asdf', 'installs', 'nodejs'), 'bin'),
  ];

  const existingEntries = basePath.split(path.delimiter).filter(Boolean);
  const existingSet = new Set(existingEntries);
  const toPrepend = [];

  for (const dir of candidates) {
    if (!dir || existingSet.has(dir) || toPrepend.includes(dir)) continue;
    try {
      if (fs.existsSync(dir)) toPrepend.push(dir);
    } catch {
      // Ignore unreadable candidates.
    }
  }

  if (toPrepend.length === 0) return basePath;
  return [...toPrepend, ...existingEntries].join(path.delimiter);
}

/**
 * Mutates `env.PATH` in place with the augmented PATH and returns `env`.
 * No-op on Windows or when `env` is falsy.
 *
 * @param {NodeJS.ProcessEnv} env - Environment object destined for spawn().
 * @returns {NodeJS.ProcessEnv} The same env object, PATH-augmented on POSIX.
 */
export function augmentEnvPath(env) {
  if (!env || process.platform === 'win32') return env;
  env.PATH = getAugmentedPath(env.PATH || process.env.PATH || '');
  return env;
}

export default { getAugmentedPath, augmentEnvPath };
