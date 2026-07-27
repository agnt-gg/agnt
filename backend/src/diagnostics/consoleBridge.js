/**
 * console bridge — the adoption strategy.
 *
 * main.js alone has 76 bare console.* calls; the backend has thousands.
 * Converting them by hand is weeks of churn and merge conflict for no
 * behavioural gain. Patch the SINK instead of the call sites: one install per
 * process and every existing console line in AGNT becomes durable, correlated,
 * redacted and bounded, with zero edits anywhere else.
 *
 *   console.error('[buzz-trigger] poll error:', err)
 *     -> { lvl:'ERROR', src:'buzz-trigger', msg:'poll error:', err:{code:'ECONNREFUSED'} }
 *
 * Structured call sites (recorder.error('src', 'msg', {data})) then become a
 * gradual opt-in improvement rather than a prerequisite.
 */

const METHOD_LEVELS = [
  ['log', 'INFO'],
  ['info', 'INFO'],
  ['warn', 'WARN'],
  ['error', 'ERROR'],
  ['debug', 'DEBUG'],
  ['trace', 'TRACE'],
];

/**
 * @param {import('./Recorder.js').Recorder} recorder
 * @param {object}  [opts]
 * @param {Console} [opts.target=console]
 * @param {boolean} [opts.passthrough=true]  keep writing to the real console
 * @returns {() => void} uninstall
 */
export function installConsoleBridge(recorder, { target = console, passthrough = true } = {}) {
  if (!recorder || target.__agntBridged) return () => {};

  // Store the ORIGINAL references, not bound copies, so uninstall restores
  // exact function identity. Binding here would mean repeated install/uninstall
  // cycles slowly wrapped the console in layers of bindings.
  const native = {};
  // Re-entrancy guard: if the recorder itself ever console.errors (disk full,
  // EACCES) an unguarded bridge would recurse until the stack blew.
  let inside = false;

  for (const [method, level] of METHOD_LEVELS) {
    if (typeof target[method] !== 'function') continue;
    native[method] = target[method];

    target[method] = (...args) => {
      if (passthrough) native[method].apply(target, args);
      if (inside) return;
      inside = true;
      try {
        recorder.raw(level, args);
      } catch {
        /* never let logging break the caller */
      } finally {
        inside = false;
      }
    };
  }

  target.__agntBridged = true;

  return function uninstall() {
    for (const [method] of METHOD_LEVELS) {
      if (native[method]) target[method] = native[method];
    }
    delete target.__agntBridged;
  };
}

export default installConsoleBridge;
