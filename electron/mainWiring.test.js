/**
 * Source-level contract for the remote-backend guards in main.js.
 *
 * main.js cannot be imported in a test: it calls app.getPath, registers
 * protocol handlers and forks processes at module scope. But the whole safety
 * argument for this feature rests on three specific guards being present, and
 * "the resolver is well tested" is worth nothing if a later refactor drops the
 * `if` that consults it.
 *
 * So this asserts the wiring at the source level — the same approach as
 * routeSecurity.test.js, for the same reason: an invariant nobody can verify is
 * an invariant that silently rots.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');

/** Strip comments so a rule can never be satisfied by prose describing it. */
const code = main
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('main.js — connection resolution', () => {
  it('resolves the connection exactly once, from the shared resolver', () => {
    expect(code).toMatch(/import\s*\{[\s\S]*?resolveConnection[\s\S]*?\}\s*from\s*'\.\/electron\/connectionConfig\.js'/);
    expect((code.match(/resolveConnection\(/g) || []).length).toBe(1);
  });

  it('defaults to local if resolution itself throws', () => {
    // A broken config file must never stop the app from booting.
    const block = /let connection = \{[\s\S]{0,600}?catch \(err\) \{[\s\S]{0,200}?\}/.exec(code);
    expect(block, 'connection resolution is not wrapped in try/catch').not.toBeNull();
    expect(block[0]).toMatch(/mode: 'local'/);
  });
});

describe('main.js — the three guards', () => {
  it('GUARD 1: does not respawn a local backend in remote mode', () => {
    expect(code).toMatch(/if \(isRemoteMode\(\)\) \{[\s\S]{0,160}?return;/);
  });

  it('GUARD 2: only forks a local backend when one will be used', () => {
    expect(code).toMatch(/if \(!isRemoteMode\(\)\) startBackend\(\);/);
    // and never unconditionally
    expect(code).not.toMatch(/\n\s*startBackend\(\);\s*\n\s*\n\s*\/\/ Instead of a fixed delay/);
  });

  it('GUARD 3: the window URL is no longer hardcoded to localhost', () => {
    expect(code).toMatch(/mainWindow\.loadURL\(isRemoteMode\(\) \? connection\.url : `http:\/\/localhost:\$\{port\}`\)/);
    expect(code).not.toMatch(/mainWindow\.loadURL\(`http:\/\/localhost:\$\{port\}`\)/);
  });
});

describe('main.js — failure behaviour', () => {
  it('NEVER silently falls back to a local backend when the remote is down', () => {
    // Falling back would boot a second, empty database and present it as the
    // user's instance — the exact confusion this feature exists to remove.
    const onFail = /onFail: \(\) => \{([\s\S]*?)\n    \},/.exec(code);
    expect(onFail, 'remote onFail handler not found').not.toBeNull();
    expect(onFail[1]).not.toMatch(/startBackend\(/);
    expect(onFail[1]).toMatch(/connection-error\.html/);
  });

  it('bounds the remote health poll so the user is told rather than left spinning', () => {
    expect(code).toMatch(/maxAttempts: \d+/);
  });

  it('local mode keeps unbounded polling (today\'s behaviour)', () => {
    expect(code).toMatch(/maxAttempts = Number\.isFinite\(opts\.maxAttempts\) \? opts\.maxAttempts : Infinity/);
  });

  it('supports https remotes (AGNT Cloud), not just http', () => {
    expect(code).toMatch(/const transport = isHttps \? https : http/);
  });
});

describe('IPC surface', () => {
  it.each(['connection:get', 'connection:test', 'connection:set', 'connection:relaunch'])(
    'main registers %s',
    (channel) => {
      expect(code).toContain(`ipcMain.handle('${channel}'`);
    }
  );

  it('preload exposes the connection bridge', () => {
    expect(preload).toMatch(/connection:\s*\{/);
    for (const c of ['connection:get', 'connection:test', 'connection:set', 'connection:relaunch']) {
      expect(preload).toContain(c);
    }
  });

  it('refuses to overwrite an env-pinned connection', () => {
    expect(code).toMatch(/connection\.source === 'env'[\s\S]{0,200}?ok: false/);
  });

  it('probes the remote from the MAIN process, so there is no origin and no CORS', () => {
    expect(code).toMatch(/ipcMain\.handle\('connection:test'[\s\S]*?net\.fetch\(/);
  });
});

describe('main.js — renderer permissions', () => {
  // MEASURED: Chromium asks the session permission handler for 'fullscreen'
  // when a renderer calls element.requestFullscreen(). A denial does NOT
  // reject the promise and does NOT fire 'fullscreenerror' — the promise never
  // settles — while document.fullscreenEnabled stays true, so the browser
  // still paints a fullscreen button that silently does nothing. That is not
  // a failure mode anyone will diagnose from the symptom, so it is pinned here.

  /** The permission sets as main.js actually ships them. */
  function permissionSets() {
    const out = {};
    for (const name of ['MEDIA_PERMISSIONS', 'CLIPBOARD_PERMISSIONS', 'DISPLAY_PERMISSIONS']) {
      const m = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(code);
      out[name] = m
        ? m[1]
            .split(',')
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
            .filter(Boolean)
        : null;
    }
    return out;
  }

  it('grants fullscreen, or every <video>, chart popout and artifact preview is dead', () => {
    const sets = permissionSets();
    expect(sets.DISPLAY_PERMISSIONS, 'DISPLAY_PERMISSIONS not found in main.js').not.toBeNull();
    expect(sets.DISPLAY_PERMISSIONS).toContain('fullscreen');
  });

  it('still grants the media + clipboard permissions it always did', () => {
    // The other half of the contract: "grant everything" would satisfy the
    // test above while breaking nothing here, so both directions are pinned.
    const sets = permissionSets();
    expect(sets.MEDIA_PERMISSIONS).toEqual(expect.arrayContaining(['media', 'microphone', 'audioCapture']));
    expect(sets.CLIPBOARD_PERMISSIONS).toEqual(
      expect.arrayContaining(['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
    );
  });

  it('feeds BOTH handlers from one list, so a grant cannot drift out of one', () => {
    // They were duplicated literals. Duplication is how the request handler and
    // the check handler end up disagreeing about the same capability.
    expect(code).toMatch(/setPermissionRequestHandler\([\s\S]{0,400}?ALLOWED_PERMISSIONS\.includes\(permission\)/);
    expect(code).toMatch(/setPermissionCheckHandler\([\s\S]{0,400}?ALLOWED_PERMISSIONS\.includes\(permission\)/);
    expect(code, 'a hardcoded allowlist literal is back').not.toMatch(/const allowedPermissions\s*=\s*\[/);
  });

  it('says so out loud when it denies something', () => {
    // The whole reason this bug survived: the denial was invisible.
    expect(code).toMatch(/if \(!granted\)[\s\S]{0,120}?permissions[\s\S]{0,40}?denied/);
  });
});

describe('main.js — window fullscreen vs renderer fullscreen', () => {
  // MEASURED: HTML5 element fullscreen also puts the WINDOW in fullscreen, so
  // isFullScreen() cannot distinguish "user pressed F11" from "Chromium is
  // showing a fullscreen video". Driving setFullScreen() in that state (and
  // preventDefault()-ing the Escape that would have unwound it) leaves
  // document.fullscreenElement set with no fullscreen window — after which the
  // next fullscreen click does nothing until reload.

  it('tracks whether the renderer owns fullscreen', () => {
    expect(code).toMatch(/mainWindow\.on\('enter-html-full-screen'[\s\S]{0,120}?rendererOwnsFullScreen = true/);
    expect(code).toMatch(/mainWindow\.on\('leave-html-full-screen'[\s\S]{0,120}?rendererOwnsFullScreen = false/);
  });

  it('the F11/Escape handler bails out while the renderer owns fullscreen', () => {
    const handler = /before-input-event', \(event, input\) => \{([\s\S]*?)\n    \}\);/.exec(code);
    expect(handler, 'before-input-event handler not found').not.toBeNull();
    // The guard must be the FIRST thing in the handler and must return, not
    // merely be mentioned — a later `if` would still let F11 fire first.
    expect(handler[1].trimStart()).toMatch(/^if \(rendererOwnsFullScreen\) return;/);
  });

  it('still handles F11/Escape normally when the renderer does not', () => {
    const handler = /before-input-event', \(event, input\) => \{([\s\S]*?)\n    \}\);/.exec(code);
    expect(handler[1]).toMatch(/input\.key === 'F11'[\s\S]{0,200}?setFullScreen\(!isFullScreen\)/);
    expect(handler[1]).toMatch(/input\.key === 'Escape'[\s\S]{0,120}?setFullScreen\(false\)/);

    // REACHABILITY, not just presence. A negative control that inserted a bare
    // `return;` after the guard left F11/Escape permanently dead while every
    // assertion above still passed — the source text was there, just
    // unreachable. The guarded return is a single-line `if (...) return;`, so
    // any `return;` alone on a line is by construction unconditional.
    const unconditionalReturns = handler[1].match(/^\s*return;\s*$/gm) || [];
    expect(unconditionalReturns, 'an unconditional early return makes F11/Escape unreachable').toEqual([]);
  });
});

describe('connection error page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'electron', 'connection-error.html'), 'utf8');

  it('offers both escape hatches', () => {
    expect(html).toMatch(/id="retry"/);
    expect(html).toMatch(/id="local"/);
  });

  it('uses the preload bridge, which survives having no frontend to talk to', () => {
    expect(html).toMatch(/window\.electron\?\.connection/);
    expect(html).toMatch(/relaunch/);
  });
});

describe('electron-builder packaging', () => {
  // main.js imports ./electron/connectionConfig.js and loadFile() for connection-error.html.
  // electron-builder uses an explicit allowlist (build.files) — if electron/ is missing,
  // the packaged app throws ERR_MODULE_NOT_FOUND at launch.
  it('includes the electron/ directory in build.files', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const files = pkg.build?.files || [];
    expect(files).toEqual(expect.arrayContaining(['electron/**/*']));
  });
});
