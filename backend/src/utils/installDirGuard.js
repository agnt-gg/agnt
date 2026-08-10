import path from 'path';
import os from 'os';

/**
 * The workspace root may never live inside AGNT's own install directory.
 *
 * Why this file exists, stated plainly: a Windows update does not patch an
 * install in place. electron-builder's NSIS installer runs the OLD uninstaller
 * first (installSection.nsh), and that uninstaller does this to $INSTDIR:
 *
 *     ${if} ${isUpdated}
 *       Call un.atomicRMDir      ; renames EVERY file and subdir out to a temp dir
 *     ${endif}
 *     RMDir /r $INSTDIR          ; then deletes whatever is left
 *
 * `un.atomicRMDir` is a blind FindFirst/FindNext recursion. It has no concept
 * of "this subdirectory is the user's work". The temp dir it moves things to
 * is $PLUGINSDIR, which NSIS purges when the installer exits. No prompt, no
 * Recycle Bin, no recovery.
 *
 * The default install root (%LOCALAPPDATA%\Programs\agnt) and the default
 * workspace root (%APPDATA%\AGNT\projects) are far apart, so the defaults were
 * never at risk. But `allowToChangeInstallationDirectory: true` lets a user
 * install to D:\AGNT, and until this guard existed the workspace picker would
 * happily accept D:\AGNT\projects — a folder our own updater is GUARANTEED to
 * destroy. Two reasonable choices, one unrecoverable outcome, zero warnings.
 *
 * macOS and Linux are the same shape: replacing AGNT.app replaces everything
 * under it, and a .deb/AppImage upgrade rewrites /opt/AGNT.
 *
 * This module answers two questions and nothing else:
 *   installRoot()          — where is the app installed (null if undeterminable)
 *   describeUnsafeRoot(p)  — is p doomed, and what do we tell the human
 */

/**
 * Resolve AGNT's install directory from APP_PATH (set by main.js to its own
 * __dirname before forking the backend).
 *
 * Packaged layouts:
 *   Windows/Linux  <INSTALL>/resources/app.asar   (or /resources/app unpacked)
 *   macOS          <INSTALL>/AGNT.app/Contents/Resources/app.asar
 *
 * In development APP_PATH is the repo checkout, whose parent is not a
 * `resources` directory — we return null and enforce nothing, because in dev
 * there is no installer and therefore no hazard.
 *
 * Returns an absolute path, or null when it cannot be determined SAFELY.
 * Null always means "do not enforce" — a guard that guesses wrong would lock
 * users out of their own folders, which is a worse failure than the one it
 * prevents.
 */
export function installRoot() {
  const appPath = process.env.APP_PATH;
  if (!appPath || typeof appPath !== 'string') return null;

  const resolved = path.resolve(appPath);
  const base = path.basename(resolved).toLowerCase();
  if (base !== 'app.asar' && base !== 'app') return null;

  const resourcesDir = path.dirname(resolved);
  if (path.basename(resourcesDir).toLowerCase() !== 'resources') return null;

  let root = path.dirname(resourcesDir);

  // macOS: .../AGNT.app/Contents/Resources -> the bundle is the unit that gets
  // replaced, not Contents/.
  if (path.basename(root) === 'Contents' && path.dirname(root).endsWith('.app')) {
    root = path.dirname(root);
  }

  // Refuse absurd answers. If the install root resolved to a filesystem root
  // or the user's home directory, enforcing containment would reject every
  // path on the machine. Treat as undeterminable.
  const parsed = path.parse(root);
  if (root === parsed.root) return null;
  if (pathsEqual(root, os.homedir())) return null;

  return root;
}

function pathsEqual(a, b) {
  if (!a || !b) return false;
  const norm = (p) => {
    const r = path.resolve(p);
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(a) === norm(b);
}

/**
 * True when `child` is inside `parent` (or is `parent`).
 *
 * Uses path.relative rather than startsWith so that prefix collisions
 * (`C:\AGNT` vs `C:\AGNTdata`) and Windows case differences are both correct.
 */
export function isInside(child, parent) {
  if (!child || !parent) return false;
  const a = path.resolve(child);
  const b = path.resolve(parent);
  const rel = path.relative(b, a);
  if (rel === '') return true;
  if (rel.startsWith('..')) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

/**
 * Decide whether a candidate workspace root is destroyed by an update.
 *
 * Both directions are unsafe, for different reasons:
 *   workspace inside install  — the whole workspace is deleted (WtpK14's case)
 *   install inside workspace  — a subtree of the workspace is deleted, and any
 *                               work the user filed under it goes with it
 *
 * Returns null when the path is safe, otherwise a { code, installRoot, message }
 * suitable for returning to the client verbatim.
 */
export function describeUnsafeRoot(candidate) {
  const root = installRoot();
  if (!root || !candidate) return null;

  const target = path.resolve(candidate);

  if (isInside(target, root)) {
    return {
      code: 'workspace_inside_install_dir',
      installRoot: root,
      workspaceRoot: target,
      message:
        `That folder is inside AGNT's install directory (${root}). ` +
        `Installing an AGNT update deletes everything in that directory, ` +
        `including your files — permanently, with no Recycle Bin. ` +
        `Please choose a folder somewhere else.`,
    };
  }

  if (isInside(root, target)) {
    return {
      code: 'install_dir_inside_workspace',
      installRoot: root,
      workspaceRoot: target,
      message:
        `AGNT is installed inside that folder (${root}). ` +
        `Installing an AGNT update deletes that install directory and ` +
        `everything under it, so any work you keep there would be lost. ` +
        `Please choose a folder that does not contain AGNT itself.`,
    };
  }

  return null;
}

export default { installRoot, isInside, describeUnsafeRoot };
