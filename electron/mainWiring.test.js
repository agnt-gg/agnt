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

/**
 * Extract the balanced `{ ... }` body that follows `marker`.
 *
 * Anchors of the form /...\n    \}\);/ are coupled to INDENTATION: reindenting
 * a block (e.g. lifting it out of a callback into a named function) fails them
 * while the code they describe is untouched. That is a false failure, and false
 * failures are how a suite gets loosened until it proves nothing. Brace matching
 * does not care about whitespace.
 *
 * Comments are already stripped; braces inside string literals would confuse
 * this, and none of the blocks asserted on below contain one.
 */
function blockAfter(src, marker, opts = {}) {
  if (!src) return null;
  const at = src.indexOf(marker);
  if (at === -1) return null;
  // A destructured parameter list is itself a `{...}`, so for a callback the
  // search has to start past the arrow or it returns the parameters.
  let from = at + marker.length;
  if (opts.afterArrow) {
    from = src.indexOf('=>', from);
    if (from === -1) return null;
  }
  const open = src.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** The body of the app.on('ready') handler, where both boot paths live. */
const readyBody = () => blockAfter(code, "app.on('ready'");

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
    expect(code).toMatch(/if \(!isRemoteMode\(\)\) ensureLocalBackend\(\);/);
    // and never unconditionally
    expect(code).not.toMatch(/\n\s*startBackend\(\);\s*\n\s*\n\s*\/\/ Instead of a fixed delay/);
  });

  it('GUARD 2b: the boot and fallback paths cannot fork two local backends', () => {
    // Both the normal local boot and the per-session fallback need a local
    // backend, so startBackend() gained a second caller. Forking twice would
    // race two servers onto the same port.
    const guard = blockAfter(code, 'function ensureLocalBackend');
    expect(guard, 'ensureLocalBackend not found').not.toBeNull();
    expect(guard).toMatch(/if \(localBackendSpawned\) return;/);
    expect(guard).toMatch(/localBackendSpawned = true;[\s\S]{0,80}?startBackend\(\);/);

    // Exactly two call sites, and the second is the SANCTIONED RESPAWN, which
    // must be able to spawn again after the backend exits with code 42 — it
    // deliberately does not go through the once-per-launch guard.
    const calls = code.match(/\bstartBackend\(\);/g) || [];
    expect(calls.length, 'unexpected startBackend() call site').toBe(2);
    expect(blockAfter(code, 'function handleBackendExit')).toMatch(/startBackend\(\);/);
  });

  it('GUARD 3: the window URL is no longer hardcoded to localhost', () => {
    expect(code).toMatch(/mainWindow\.loadURL\(isRemoteActive\(\) \? connection\.url : `http:\/\/localhost:\$\{port\}`\)/);
    expect(code).not.toMatch(/mainWindow\.loadURL\(`http:\/\/localhost:\$\{port\}`\)/);
  });

  it('GUARD 3b: the window target follows the ACTIVE mode, not the configured one', () => {
    // After a per-session fallback the app is talking to localhost while the
    // configuration still says remote. Keying the window off isRemoteMode()
    // would send it back to the dead remote on the next load.
    expect(code).toMatch(/const isRemoteActive = \(\) => activeMode === 'remote'/);
    expect(code).not.toMatch(/loadURL\(isRemoteMode\(\)/);
  });
});

describe('main.js — the app must never become a window-less process', () => {
  // THE BUG NATHAN HIT. createWindow() used to be reachable ONLY from the health
  // poll's success callback, so a remote that accepted TCP and never replied
  // left a running process with no window at all — measured at up to 366s.
  // Indistinguishable from a hang, and with no way to reach any setting.

  /**
   * The remote branch of the ready handler. Scoped through readyBody() because
   * GUARD 1 in handleBackendExit is also an `if (isRemoteMode())` — matching
   * against the whole file silently asserted against the wrong branch.
   */
  const readyRemoteBranch = () => blockAfter(readyBody(), 'if (isRemoteMode())');

  it('creates the window BEFORE it starts polling the remote', () => {
    const body = readyRemoteBranch();
    expect(body, 'remote boot branch not found in the ready handler').not.toBeNull();
    const windowAt = body.indexOf('createWindow(');
    const pollAt = body.indexOf('beginRemoteConnect(');
    expect(windowAt, 'remote boot does not create a window').toBeGreaterThan(-1);
    expect(pollAt, 'remote boot does not start the health poll').toBeGreaterThan(-1);
    expect(windowAt, 'the window must exist before the poll can hang').toBeLessThan(pollAt);
  });

  it('shows the status page in that first window, not the unreachable origin', () => {
    expect(readyRemoteBranch()).toMatch(/createWindow\(\{ initial: 'status' \}\)/);
    expect(blockAfter(code, "opts.initial === 'status'")).toMatch(/loadFile\(statusPagePath\(\)\)/);
  });

  it('attaches window behaviour on BOTH boot paths', () => {
    // The F11/title/fullscreen handlers used to be inline in the local-only
    // success callback; the remote path creates its window elsewhere and would
    // otherwise silently lose all of them.
    expect((code.match(/attachWindowBehaviour\(\);/g) || []).length).toBe(2);
    expect(code).toMatch(/function attachWindowBehaviour\(\)/);
  });

  it('recovers when a load fails after the health check passed', () => {
    // Health can pass and the page load still fail: the origin drops, or it
    // serves no frontend. Chromium then paints its own error page, which has no
    // escape hatch and no menu. This also covers a mid-session outage + reload.
    // Scoped to mainWindow: there is a pre-existing did-fail-load handler on
    // popup windows, and an unscoped match asserted against that one instead.
    const handler = blockAfter(code, "mainWindow.webContents.on('did-fail-load'");
    expect(handler, 'no did-fail-load handler on the main window').not.toBeNull();
    expect(handler).toMatch(/showStatusPage\(/);
    expect(handler).toMatch(/if \(!isMainFrame\) return;/);
    // -3 is ERR_ABORTED, which every superseded navigation emits. Treating it
    // as a failure would throw up the error page during normal use.
    expect(handler).toMatch(/errorCode === -3/);
    // Local mode must keep exactly today's behaviour.
    expect(handler).toMatch(/if \(!isRemoteActive\(\)\) return;/);
    // The status page is itself a file:// load; reacting to it would loop.
    expect(handler).toMatch(/startsWith\('file:\/\/'\)/);

    // REACHABILITY, not just presence — the same trap already recorded for the
    // F11 handler below. A negative control that inserted a bare `return;` at
    // the top left this recovery permanently dead while every assertion above
    // still passed. Every legitimate early exit here is a single-line
    // `if (...) return;`, so a `return;` alone on a line is unconditional.
    const unconditionalReturns = handler.match(/^\s*return;\s*$/gm) || [];
    expect(unconditionalReturns, 'an unconditional early return makes the recovery unreachable').toEqual([]);
  });
});

describe('main.js — failure behaviour', () => {
  it('does not fall back to a local backend UNLESS the user opted in', () => {
    // Falling back boots a different database. Doing that silently is the exact
    // "where did all my agents go?" confusion this feature exists to remove, so
    // it is gated on an explicit, default-off preference.
    const body = blockAfter(blockAfter(code, 'function beginRemoteConnect'), 'onFail:', { afterArrow: true });
    expect(body, 'remote onFail handler not found').not.toBeNull();
    expect(body).toMatch(/if \(connection\.fallbackToLocal === true\)[\s\S]{0,220}?startLocalSessionFallback\(/);
    // Strict equality, not truthiness: a stray string in a hand-edited config
    // must not be able to enable it.
    expect(body).not.toMatch(/if \(connection\.fallbackToLocal\)\s*\{/);
    // And the default path still fails loud with a way out.
    expect(body).toMatch(/showStatusPage\(\{ phase: 'failed'/);
  });

  it('bounds the remote poll by WALL CLOCK, which is the only bound a user feels', () => {
    // It used to be `maxAttempts: 24`, documented as "~12s". Measured against a
    // server that accepted TCP and never replied, that was really 366s, because
    // an attempt count says nothing about how long an attempt takes.
    const health = fs.readFileSync(path.join(ROOT, 'electron', 'backendHealth.js'), 'utf8');
    expect(health).toMatch(/deadlineMs/);
    expect(code, 'main.js should no longer hand-roll a poll bound').not.toMatch(/maxAttempts: \d+/);
    // A deadline enforced only by a pre-attempt check cannot interrupt a hung
    // request; it has to be a real timer.
    expect(health).toMatch(/deadlineTimer = setTimer\(/);
  });

  it('delegates health polling to the tested module instead of inlining it', () => {
    expect(code).toMatch(/import \{ waitForBackend as pollBackendHealth \} from '\.\/electron\/backendHealth\.js'/);
    expect(code, 'the inline poller is back').not.toMatch(/function waitForBackend\(/);
  });
});

describe('main.js — per-session fallback must not rewrite the user\'s setting', () => {
  const fallback = () => blockAfter(code, 'function startLocalSessionFallback');

  it('starts a local backend and loads it', () => {
    expect(fallback(), 'startLocalSessionFallback not found').not.toBeNull();
    expect(fallback()).toMatch(/ensureLocalBackend\(\)/);
    expect(fallback()).toMatch(/loadActiveTarget\(\)/);
  });

  it('never writes connection.json', () => {
    // A transient outage must not cost the user the remote address they
    // configured, and the next launch has to try the remote again.
    expect(fallback()).not.toMatch(/writeConnectionConfig|writeConfig/);
  });

  it('records that it fell back, so the UI cannot claim to be remote', () => {
    expect(fallback()).toMatch(/fellBack = true/);
    expect(fallback()).toMatch(/activeMode = 'local'/);
    const get = blockAfter(code, "ipcMain.handle('connection:get'");
    expect(get).toMatch(/fellBack/);
    expect(get).toMatch(/activeMode/);
  });

  it('cancels the in-flight remote poll so it cannot fire after the switch', () => {
    expect(fallback()).toMatch(/healthPoll\?\.cancel\(/);
  });
});

const IPC_CHANNELS = [
  'connection:get',
  'connection:test',
  'connection:set',
  'connection:relaunch',
  'connection:retry',
  'connection:use-local-now',
];

describe('IPC surface', () => {
  it.each(IPC_CHANNELS)('main registers %s', (channel) => {
    expect(code).toContain(`ipcMain.handle('${channel}'`);
  });

  it('preload exposes the connection bridge', () => {
    expect(preload).toMatch(/connection:\s*\{/);
    for (const c of IPC_CHANNELS) {
      expect(preload).toContain(c);
    }
  });

  it('preload streams connection state, so the status page can show progress', () => {
    expect(preload).toMatch(/connection:state/);
    // Must hand back an unsubscribe or every mount leaks a listener.
    expect(preload).toMatch(/removeListener\('connection:state'/);
  });

  it('retry recovers in place, without restarting the process', () => {
    expect(code).toMatch(/ipcMain\.handle\('connection:retry'[\s\S]{0,160}?retryConfiguredConnection\(\)/);
    const retry = blockAfter(code, 'function retryConfiguredConnection');
    expect(retry).not.toBeNull();
    expect(retry, 'retry must not relaunch the app').not.toMatch(/app\.relaunch/);
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

  // These two anchors used to be /...\n    \}\);/ — coupled to the handler being
  // indented inside a callback. Lifting the block into attachWindowBehaviour()
  // reindented it and failed both assertions while the handler was untouched.
  const inputHandler = () => blockAfter(code, "'before-input-event'");

  it('the F11/Escape handler bails out while the renderer owns fullscreen', () => {
    const handler = inputHandler();
    expect(handler, 'before-input-event handler not found').not.toBeNull();
    // The guard must be the FIRST thing in the handler and must return, not
    // merely be mentioned — a later `if` would still let F11 fire first.
    expect(handler.trimStart()).toMatch(/^if \(rendererOwnsFullScreen\) return;/);
  });

  it('still handles F11/Escape normally when the renderer does not', () => {
    const handler = inputHandler();
    expect(handler).toMatch(/input\.key === 'F11'[\s\S]{0,200}?setFullScreen\(!isFullScreen\)/);
    expect(handler).toMatch(/input\.key === 'Escape'[\s\S]{0,120}?setFullScreen\(false\)/);

    // REACHABILITY, not just presence. A negative control that inserted a bare
    // `return;` after the guard left F11/Escape permanently dead while every
    // assertion above still passed — the source text was there, just
    // unreachable. The guarded return is a single-line `if (...) return;`, so
    // any `return;` alone on a line is by construction unconditional.
    const unconditionalReturns = handler.match(/^\s*return;\s*$/gm) || [];
    expect(unconditionalReturns, 'an unconditional early return makes F11/Escape unreachable').toEqual([]);
  });
});

describe('connection status page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'electron', 'connection-error.html'), 'utf8');
  const script = html.slice(html.indexOf('<script>'));

  it('offers every escape hatch', () => {
    expect(html).toMatch(/id="retry"/);
    expect(html).toMatch(/id="local"/);
    expect(html).toMatch(/id="always"/);
  });

  it('uses the preload bridge, which survives having no frontend to talk to', () => {
    expect(html).toMatch(/window\.electron\?\.connection/);
    expect(html).toMatch(/relaunch/);
  });

  it('renders a live connecting phase, not just a failure', () => {
    // The page is now shown from t=0. If it only knew how to render "failed",
    // the first thing a user saw on every remote launch would be an error.
    expect(script).toMatch(/onState/);
    expect(script).toMatch(/phase === 'failed'/);
    expect(script).toMatch(/attempt/i);
  });

  it('offers the per-session fallback BEFORE anything has failed', () => {
    // "Use this computer" must not be hidden behind the failed state: it is the
    // way out while a slow server is still being waited on.
    const localBtn = /<button id="local"[^>]*>/.exec(html);
    expect(localBtn, 'the local button is missing').not.toBeNull();
    expect(localBtn[0], 'the way out must not start hidden').not.toMatch(/hidden/);
    // Retry, by contrast, only makes sense once a poll has actually given up.
    expect(/<button class="primary" id="retry"[^>]*>/.exec(html)[0]).toMatch(/hidden/);
  });

  it('distinguishes the session fallback from a permanent config change', () => {
    expect(script).toMatch(/useLocalNow/);
    expect(script).toMatch(/set\?\.\(\{ mode: 'local' \}\)/);
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
