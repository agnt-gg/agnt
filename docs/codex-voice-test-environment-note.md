# Test environment follow-up — 2026-09-08

The six existing chatUnified test files initially failed before assertions under Node 26.8.1 because native localStorage was undefined in the worker global and shadowed jsdom storage. No test source or production storage code was changed to address this.

A process-only ES module preload deletes configurable globalThis localStorage/sessionStorage properties before jsdom setup. Run Vitest with NODE_OPTIONS=--import=<preload> so workers receive it. jsdom supplies the actual storage implementation.

With that preload, **62/62 tests passed across six existing chatUnified regression files**, 1.40 seconds. This is in addition to 566 voice frontend and 92 backend tests. It does not prove new request observer semantics or browser media; those remain dedicated integration/live gates.

The production frontend build also passed. Test dependencies reused existing installed modules via symlinks without install or lockfile changes, so a clean dependency install/CI matrix remains required before PR.

Preload contents:

    for (const name of ['localStorage','sessionStorage']) {
      const descriptor=Object.getOwnPropertyDescriptor(globalThis,name);
      if (descriptor?.configurable) delete globalThis[name];
    }

No real browser microphone, provider request or GPU synthesis is part of these fixture tests.
