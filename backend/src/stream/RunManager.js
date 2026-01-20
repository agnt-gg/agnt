class RunManager {
  constructor() {
    this.runs = new Map(); // conversationId -> run
  }

  create(conversationId) {
    let run = this.runs.get(conversationId);
    if (run) return run;

    const abortController = new AbortController();
    run = {
      id: conversationId,
      llmAbortController: abortController,
      cancelled: false,
      reason: null,
      children: new Set(),
      cleanupFns: [],
    };
    this.runs.set(conversationId, run);
    return run;
  }

  get(conversationId) {
    return this.runs.get(conversationId) || null;
  }

  isCancelled(conversationId) {
    const run = this.runs.get(conversationId);
    return !!(run && run.cancelled);
  }

  registerChild(conversationId, childProcess) {
    const run = this.runs.get(conversationId);
    if (!run) return;
    try {
      run.children.add(childProcess);
      // If already cancelled, kill immediately
      if (run.cancelled) {
        try { childProcess.kill('SIGTERM'); } catch (_) {}
      }
      // Remove from set on exit
      const cleanup = () => {
        run.children.delete(childProcess);
        childProcess.off?.('exit', cleanup);
        childProcess.off?.('close', cleanup);
      };
      childProcess.on?.('exit', cleanup);
      childProcess.on?.('close', cleanup);
    } catch (_) {}
  }

  registerCleanup(conversationId, fn) {
    const run = this.runs.get(conversationId);
    if (!run) return;
    if (typeof fn === 'function') run.cleanupFns.push(fn);
  }

  stop(conversationId, reason = 'user_stop') {
    const run = this.runs.get(conversationId);
    if (!run) return { ok: true, already: true };

    if (!run.cancelled) {
      run.cancelled = true;
      run.reason = reason;

      // Abort LLM stream
      try { run.llmAbortController.abort(); } catch (_) {}

      // Kill all registered child processes
      for (const cp of Array.from(run.children)) {
        try { cp.kill('SIGTERM'); } catch (_) {}
      }
      run.children.clear();

      // Execute cleanup callbacks
      for (const fn of run.cleanupFns) {
        try { fn(); } catch (_) {}
      }
      run.cleanupFns = [];
    }
    return { ok: true };
  }

  clear(conversationId) {
    const run = this.runs.get(conversationId);
    if (!run) return;
    // Best-effort safety
    try { run.llmAbortController.abort(); } catch (_) {}
    run.children.clear();
    run.cleanupFns = [];
    this.runs.delete(conversationId);
  }
}

const runManager = new RunManager();
export default runManager;

