/**
 * The one line the auto-update unit tests cannot reach: the import.
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG
 * ---------------------------------------------------------------------------
 * electron/autoUpdate.test.js covers the policy thoroughly, and it does that by
 * INJECTING an autoUpdater — which is what makes the policy testable without
 * booting Electron. The cost is that the line which OBTAINS the real
 * autoUpdater is the only part of the feature no test executes.
 *
 * That line was wrong, and it shipped:
 *
 *     const { autoUpdater } = await import('electron-updater');   // undefined
 *
 * electron-updater is CommonJS. A dynamic import of a CJS module puts
 * `module.exports` on `.default`, and Node additionally synthesises named
 * exports for whatever its static analysis can see. It sees the CLASSES
 * (AppUpdater, NsisUpdater, …) but not `autoUpdater`, because that one is a
 * lazy getter created at runtime. So the destructure silently yielded
 * undefined, and the app reported the useless
 *
 *     [update] not armed: Cannot set properties of undefined
 *                         (setting 'autoDownload')
 *
 * Auto-update was completely inert in the packaged app, and the log line was
 * far enough from the cause to look like a missing dependency.
 *
 * These tests load the REAL module. They are the anti-vacuity for the whole
 * feature: everything else proves the policy is right, and this proves the
 * policy is reachable.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Ask REAL Node what the module namespace looks like.
 *
 * NOT `await import(...)` from inside this test. Vitest resolves modules
 * through Vite, whose CJS interop synthesises named exports that Node's own
 * ESM loader does not — so the naive destructure WORKS under vitest and fails
 * in the app. A test that imports it here would have passed against the broken
 * code, which is precisely how this shipped.
 *
 * main.js runs under Electron's loader, which is Node's.
 */
function namespaceShapeFromRealNode() {
  const script = `
    import('electron-updater').then((ns) => {
      process.stdout.write(JSON.stringify({
        namedAutoUpdater: typeof ns.autoUpdater,
        defaultType: typeof ns.default,
        defaultHasAutoUpdater: !!Object.getOwnPropertyDescriptor(ns.default ?? {}, 'autoUpdater'),
        keys: Object.keys(ns),
      }));
    });
  `;
  const env = { ...process.env };
  // Blanking it is not unsetting it: Electron reads this with getenv(), so an
  // empty string still counts as set. Irrelevant for plain node here, but the
  // habit has cost real debugging time.
  delete env.ELECTRON_RUN_AS_NODE;

  return JSON.parse(
    execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 60000,
      env,
    }),
  );
}

describe('electron-updater is CommonJS, and that changes how it must be imported', () => {
  const shape = namespaceShapeFromRealNode();

  it('the namespace has NO autoUpdater — the naive destructure yields undefined', () => {
    // The bug, stated as a fact about the dependency. If this ever starts
    // failing, electron-updater changed its export shape and the `.default` hop
    // in main.js may be removable — until then it is the reason that hop exists.
    expect(
      shape.namedAutoUpdater,
      'electron-updater now exposes autoUpdater as a named export — re-check main.js',
    ).toBe('undefined');
  });

  it('it lives on .default, which is where CJS exports land', () => {
    expect(shape.defaultType).toBe('object');
    // The VALUE is never read: it is a lazy getter that calls app.getVersion(),
    // so touching it outside Electron throws. Its existence is the whole claim.
    expect(shape.defaultHasAutoUpdater).toBe(true);
  });

  it('ANTI-VACUITY: the module really did load, classes and all', () => {
    // Without this, both assertions above would pass just as happily against a
    // module that failed to load and returned an empty namespace.
    expect(shape.keys).toContain('NsisUpdater');
    expect(shape.keys).toContain('AppUpdater');
  });
});

describe('main.js obtains the updater the way that actually works', () => {
  const main = fs.readFileSync(path.join(REPO_ROOT, 'main.js'), 'utf8');

  it('reads through .default', () => {
    expect(main).toMatch(/\.default\?\.autoUpdater/);
  });

  it('never destructures autoUpdater straight off the import', () => {
    // `const { autoUpdater } = await import('electron-updater')` — the original
    // bug, in one regex.
    expect(
      /const\s*\{\s*autoUpdater\s*\}\s*=\s*await\s+import\(\s*['"]electron-updater['"]\s*\)/.test(main),
      'main.js destructures autoUpdater directly off the import namespace — that is undefined for a CJS module',
    ).toBe(false);
  });

  it('fails loudly rather than four lines later', () => {
    // The original symptom pointed at the wrong place entirely. If the import
    // ever comes back empty again, say so where it happened.
    expect(main).toMatch(/electron-updater exported no autoUpdater/);
  });
});
