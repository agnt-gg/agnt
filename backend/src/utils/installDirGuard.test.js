import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import { installRoot, isInside, describeUnsafeRoot } from './installDirGuard.js';

/**
 * The bug this guards against, reproduced as a test.
 *
 * A user installed AGNT to D:\AGNT and set his workspace to D:\AGNT\projects.
 * The next update ran the old NSIS uninstaller, which moves every file under
 * $INSTDIR into a temp directory and then deletes it. His work went with it —
 * no prompt, no Recycle Bin.
 *
 * These tests pin the two things that must never regress:
 *   1. a workspace inside the install directory is REFUSED
 *   2. the guard stays silent when it cannot determine the install directory,
 *      because a false positive locks people out of their own folders
 */

const ORIGINAL_APP_PATH = process.env.APP_PATH;

/** Build a packaged-layout APP_PATH for a given install root. */
const packagedAppPath = (root) => path.join(root, 'resources', 'app.asar');

beforeEach(() => {
  delete process.env.APP_PATH;
});

afterEach(() => {
  if (ORIGINAL_APP_PATH === undefined) delete process.env.APP_PATH;
  else process.env.APP_PATH = ORIGINAL_APP_PATH;
});

describe('installRoot', () => {
  it('resolves the install directory from a packaged asar path', () => {
    const root = path.resolve('/opt/AGNT');
    process.env.APP_PATH = packagedAppPath(root);
    expect(installRoot()).toBe(root);
  });

  it('resolves an unpacked resources/app layout too', () => {
    const root = path.resolve('/opt/AGNT');
    process.env.APP_PATH = path.join(root, 'resources', 'app');
    expect(installRoot()).toBe(root);
  });

  it('resolves the .app bundle on macOS, not Contents/', () => {
    const bundle = path.resolve('/Applications/AGNT.app');
    process.env.APP_PATH = path.join(bundle, 'Contents', 'Resources', 'app.asar');
    expect(installRoot()).toBe(bundle);
  });

  it('returns null in development, where APP_PATH is the repo checkout', () => {
    process.env.APP_PATH = path.resolve('/home/dev/agnt-pro');
    expect(installRoot()).toBeNull();
  });

  it('returns null when APP_PATH is unset', () => {
    expect(installRoot()).toBeNull();
  });

  it('refuses to treat the home directory as an install root', () => {
    process.env.APP_PATH = path.join(os.homedir(), 'resources', 'app.asar');
    expect(installRoot()).toBeNull();
  });

  it('refuses to treat a filesystem root as an install root', () => {
    const fsRoot = path.parse(process.cwd()).root;
    process.env.APP_PATH = path.join(fsRoot, 'resources', 'app.asar');
    expect(installRoot()).toBeNull();
  });
});

describe('isInside', () => {
  it('treats a directory as inside itself', () => {
    expect(isInside('/opt/AGNT', '/opt/AGNT')).toBe(true);
  });

  it('detects nesting at any depth', () => {
    expect(isInside('/opt/AGNT/projects/deep/er', '/opt/AGNT')).toBe(true);
  });

  it('does not confuse a sibling that shares a prefix', () => {
    // The startsWith() implementation of this check gets this wrong.
    expect(isInside('/opt/AGNTdata', '/opt/AGNT')).toBe(false);
  });

  it('rejects a parent as being inside its child', () => {
    expect(isInside('/opt', '/opt/AGNT')).toBe(false);
  });
});

describe('describeUnsafeRoot', () => {
  it('REFUSES the exact configuration that destroyed a users work', () => {
    const install = path.resolve('/mnt/d/AGNT');
    process.env.APP_PATH = packagedAppPath(install);

    const verdict = describeUnsafeRoot(path.join(install, 'projects'));

    expect(verdict).not.toBeNull();
    expect(verdict.code).toBe('workspace_inside_install_dir');
    expect(verdict.installRoot).toBe(install);
    expect(verdict.message).toMatch(/deletes everything/i);
  });

  it('refuses the install directory itself', () => {
    const install = path.resolve('/mnt/d/AGNT');
    process.env.APP_PATH = packagedAppPath(install);
    expect(describeUnsafeRoot(install)?.code).toBe('workspace_inside_install_dir');
  });

  it('refuses a workspace that CONTAINS the install directory', () => {
    const install = path.resolve('/mnt/d/AGNT');
    process.env.APP_PATH = packagedAppPath(install);

    const verdict = describeUnsafeRoot(path.resolve('/mnt/d'));

    expect(verdict).not.toBeNull();
    expect(verdict.code).toBe('install_dir_inside_workspace');
  });

  it('allows a sibling folder that merely shares a prefix', () => {
    const install = path.resolve('/mnt/d/AGNT');
    process.env.APP_PATH = packagedAppPath(install);
    expect(describeUnsafeRoot(path.resolve('/mnt/d/AGNTprojects'))).toBeNull();
  });

  it('allows the default workspace, which was never at risk', () => {
    // Default install %LOCALAPPDATA%\Programs\agnt vs default workspace
    // %APPDATA%\AGNT\projects — different trees entirely.
    const install = path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'agnt');
    process.env.APP_PATH = packagedAppPath(install);

    const workspace = path.join(os.homedir(), 'AppData', 'Roaming', 'AGNT', 'projects');
    expect(describeUnsafeRoot(workspace)).toBeNull();
  });

  it('stays silent when the install directory cannot be determined', () => {
    process.env.APP_PATH = path.resolve('/home/dev/agnt-pro');
    expect(describeUnsafeRoot(path.resolve('/home/dev/agnt-pro/projects'))).toBeNull();
  });

  it('stays silent for an empty candidate', () => {
    process.env.APP_PATH = packagedAppPath(path.resolve('/opt/AGNT'));
    expect(describeUnsafeRoot('')).toBeNull();
  });
});
