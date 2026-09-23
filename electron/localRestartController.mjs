// Adapt only the supervisor's own ChildProcess; no PID search or broad kill.
export function createLocalRestartController({ getChild, canRestart, timeoutMs = 60000 }) {
  let pending = null;
  function finish(error, value) {
    const current = pending;
    if (!current) return;
    pending = null;
    clearTimeout(current.timer);
    current.cleanup?.();
    error ? current.reject(error) : current.resolve(value);
  }
  return {
    available() { return !pending && canRestart() && Boolean(getChild()?.pid); },
    restart(pid) {
      if (pending || !canRestart()) return Promise.reject(new Error('Supervisor unavailable or busy'));
      const child = getChild();
      if (!child || child.pid !== pid) return Promise.reject(new Error('Owned child changed'));
      return new Promise((resolve, reject) => {
        pending = { child, previousPid: pid, resolve, reject, exited: false };
        pending.timer = setTimeout(() => finish(new Error('Local recovery deadline')), timeoutMs);
        // Uses the backend's existing graceful SIGTERM handler. No SIGKILL fallback.
        try { if (!child.kill('SIGTERM')) finish(new Error('Owned child refused signal')); }
        catch { finish(new Error('Unable to stop owned child')); }
      });
    },
    exit(code, signal) {
      if (!pending) return code;
      if (!pending.exited && (code === 0 || signal === 'SIGTERM')) { pending.exited = true; return 42; }
      finish(new Error('Unexpected backend exit'));
      return code;
    },
    beforeRendererReload(contents, pid) {
      if (!pending) return;
      if (!pending.exited || pid === pending.previousPid || !contents || contents.isDestroyed()) { finish(new Error('No fresh backend or renderer')); return; }
      const previousPid = pending.previousPid;
      const loaded = () => finish(null, { pid, previousPid, frontendReloaded: true });
      const failed = (_event, code, description, url, isMainFrame) => { if (isMainFrame !== false) finish(new Error('Renderer failed loading')); };
      const destroyed = () => finish(new Error('Renderer destroyed'));
      pending.cleanup = () => { contents.removeListener('did-finish-load', loaded); contents.removeListener('did-fail-load', failed); contents.removeListener('destroyed', destroyed); };
      contents.once('did-finish-load', loaded);
      contents.on('did-fail-load', failed);
      contents.once('destroyed', destroyed);
    },
    abort() { finish(new Error('Desktop quitting or reload unavailable')); },
  };
}
