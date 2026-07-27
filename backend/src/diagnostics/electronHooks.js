/**
 * Electron-specific crash surfaces.
 *
 * Takes `app` / `crashReporter` / window accessors as ARGUMENTS rather than
 * importing 'electron', so this module stays importable (and unit-testable)
 * from the backend, which has no Electron runtime.
 *
 * Covers the five death modes that never reach a JS `try`:
 *   - renderer process gone   (killed, crashed, OOM)
 *   - child/GPU/utility gone  ('gpu-process-crashed' is deprecated in favour
 *                              of 'child-process-gone' with type 'GPU')
 *   - main-process uncaught   (handled by install.js, listed here for context)
 *   - unresponsive window     (frozen UI — no exception is ever thrown)
 *   - native / V8 abort       (only crashReporter minidumps can see these)
 */

/**
 * @param {import('./Recorder.js').Recorder} recorder
 * @param {object}   deps
 * @param {object}   deps.app             Electron app
 * @param {object}  [deps.crashReporter]  Electron crashReporter
 * @param {() => object} [deps.getState]
 * @returns {() => void} uninstall
 */
export function installElectronCrashHooks(recorder, { app, crashReporter, getState = () => ({}) }) {
  const safeState = () => {
    try {
      return getState() || {};
    } catch (err) {
      return { stateError: err?.message };
    }
  };

  // Native minidumps. uploadToServer:false keeps everything on this machine —
  // a desktop app holding OAuth tokens and private conversations does not get
  // to phone home about its crashes.
  if (crashReporter && typeof crashReporter.start === 'function') {
    try {
      crashReporter.start({
        productName: 'AGNT',
        companyName: 'AGNT',
        submitURL: '',
        uploadToServer: false,
        compress: true,
      });
      recorder.info('diagnostics', 'crashReporter started', {
        data: { dumpDir: typeof app?.getPath === 'function' ? tryPath(app, 'crashDumps') : undefined },
      });
    } catch (err) {
      recorder.warn('diagnostics', 'crashReporter failed to start', { err });
    }
  }

  const onRenderGone = (_event, webContents, details) => {
    const err = new Error(`renderer gone: ${details?.reason} (exitCode ${details?.exitCode})`);
    recorder.dumpCrash('render-process-gone', err, {
      ...safeState(),
      reason: details?.reason,
      exitCode: details?.exitCode,
      url: safeUrl(webContents),
    });
  };

  const onChildGone = (_event, details) => {
    // 'clean-exit' is a normal utility-process teardown, not a crash.
    if (details?.reason === 'clean-exit') return;
    const err = new Error(`child process gone: ${details?.type} ${details?.reason} (exitCode ${details?.exitCode})`);
    const fatal = details?.type !== 'GPU'; // a GPU crash is recoverable
    if (fatal) {
      recorder.dumpCrash('child-process-gone', err, { ...safeState(), ...details });
    } else {
      recorder.warn('diagnostics', 'gpu process crashed', { err, data: details });
    }
  };

  // Every window, automatically. Hooking a specific window at a specific call
  // site means the next window someone adds is silently unmonitored.
  const onWindowCreated = (_event, win) => watchWindow(recorder, win, getState);

  app.on('render-process-gone', onRenderGone);
  app.on('child-process-gone', onChildGone);
  app.on('browser-window-created', onWindowCreated);

  return function uninstall() {
    app.off?.('render-process-gone', onRenderGone);
    app.off?.('child-process-gone', onChildGone);
    app.off?.('browser-window-created', onWindowCreated);
  };
}

/** Attach unresponsive/responsive to one window. */
export function watchWindow(recorder, win, getState = () => ({})) {
  if (!win || typeof win.on !== 'function') return;
  win.on('unresponsive', () => {
    let state = {};
    try {
      state = getState() || {};
    } catch {
      /* ignore */
    }
    recorder.dumpCrash('unresponsive', new Error('main window stopped responding'), state);
  });
  win.on('responsive', () => recorder.warn('diagnostics', 'main window responsive again'));
}

function tryPath(app, name) {
  try {
    return app.getPath(name);
  } catch {
    return undefined;
  }
}

function safeUrl(webContents) {
  try {
    return webContents?.getURL?.();
  } catch {
    return undefined;
  }
}

export default installElectronCrashHooks;
