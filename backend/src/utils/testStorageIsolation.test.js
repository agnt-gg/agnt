// Test-storage isolation: registration gate, typed refusals, fail-closed
// tripwires (PR145 A1, P11 — v3-only semantics; the v2 token/env-override
// cases are deleted WITH the v2 implementation they pinned).
//
// What replaced the deleted v2 cases:
//   • v2 "USER_DATA_PATH outside tmpdir" containment → admitTestRoot()
//     containment (ESCAPE/ALIAS/INVALID_PATH typed errors + zero filesystem
//     effects), which is stronger: structural + filesystem validation under
//     the frozen admitted parent, not a string-prefix check.
//   • v2 "empty Data/agnt.db pre-created" → D4: admission creates NOTHING;
//     the database is created by the validated open pipeline only.
//   • v2 identity-token checks → absent by design (D2): any module instance
//     validates the same registration (see the dual-instance cases).
//
// The three regressions at the end absorb the A1 verification findings
// FV-1/FV-2/FV-8 into this in-scope file (the dedicated storageContextReset
// red-first file is pending new-file consent).
import { describe, it, expect, afterAll } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {
  requireTestStorage,
  initializeTestStorage,
  initializeTestStorageV3,
  getStorageContext,
  admitTestRoot,
  resetTestStorage,
  registerStorageHandle,
  releaseStorageHandle,
  TestStorageError,
} from '../utils/testStorageContext.js';

const KEY_V3 = Symbol.for('agnt.test.storage.v3.registration');

describe('test-storage isolation contract', () => {
  describe('requireTestStorage gate (v3-only)', () => {
    it('has a registration (vitest setup ran)', () => {
      expect(globalThis[KEY_V3]).toBeTruthy();
      expect(globalThis[KEY_V3].pid).toBe(process.pid);
      expect(globalThis[KEY_V3].bootRole).toBe('owner');
    });

    it('rejects AGNT_TEST_USE_REAL_DATA', () => {
      process.env.AGNT_TEST_USE_REAL_DATA = '1';
      try { expect(() => requireTestStorage()).toThrow('real-data escape refused'); }
      finally { delete process.env.AGNT_TEST_USE_REAL_DATA; }
    });

    it('rejects AGNT_HOME (fail-closed tripwire; env is inert to resolution — D1)', () => {
      process.env.AGNT_HOME = '/tmp/fake';
      try { expect(() => requireTestStorage()).toThrow('AGNT_HOME is refused'); }
      finally { delete process.env.AGNT_HOME; }
    });

    it('returns the admitted root and is inert to environment overrides (D1)', () => {
      const admitted = requireTestStorage();
      // Capture the admitted parent BEFORE mutating env: os.tmpdir() itself
      // honors TMPDIR, so the assertion must compare against the parent the
      // root was actually admitted under, proving resolution did not follow
      // the mutation.
      const admittedParent = admitted.root.slice(0, admitted.root.lastIndexOf(path.sep));
      const savedUdp = process.env.USER_DATA_PATH;
      const savedTmpdir = process.env.TMPDIR;
      try {
        process.env.USER_DATA_PATH = '/etc';
        process.env.TMPDIR = '/var/tmp';
        const again = requireTestStorage();
        expect(again.root).toBe(admitted.root);
        expect(again.root.startsWith(admittedParent + path.sep)).toBe(true);
        expect(requireTestStorage().root).toBe(admitted.root);
      } finally {
        process.env.USER_DATA_PATH = savedUdp;
        if (savedTmpdir === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = savedTmpdir;
      }
    });

    it('rejects forged registration with wrong pid (typed)', () => {
      const saved = globalThis[KEY_V3];
      globalThis[KEY_V3] = Object.freeze({ ...saved, pid: 99999 });
      try {
        expect(() => requireTestStorage()).toThrow(TestStorageError);
        expect(() => requireTestStorage()).toThrow(/pid 99999/);
      } finally { globalThis[KEY_V3] = saved; }
    });
  });

  describe('setup scrubbing (S8: setup scrubs; imports never erase fixture values)', () => {
    it('host auth-switch and secret env vars are absent after setup', () => {
      expect(process.env.TRUST_REMOTE_AUTH).toBeUndefined();
      expect(process.env.TRUST_PROXY).toBeUndefined();
      expect(process.env.JWT_SECRET).toBeUndefined();
      expect(process.env.SESSION_SECRET).toBeUndefined();
      expect(process.env.ENCRYPTION_KEY).toBeUndefined();
      expect(process.env.AGNT_LEGACY_ENCRYPTION_KEY).toBeUndefined();
    });

    it('AGNT_HOME is deleted by the setup, not merely ignored', () => {
      expect(process.env.AGNT_HOME).toBeUndefined();
    });

    it('legacy mirrors point at the SETUP admission root (DEC-2: set-once)', () => {
      const reg = globalThis[KEY_V3];
      expect(process.env.USER_DATA_PATH).toBe(reg.root);
      expect(process.env.__AGNT_TEST_DATA_DIR).toBe(reg.root);
    });
  });

  describe('registered root properties (v3, D4)', () => {
    it('registered root is a real directory under tmpdir', () => {
      const reg = globalThis[KEY_V3];
      expect(reg.root).toContain(path.basename(fs.realpathSync(os.tmpdir())));
      const st = fs.lstatSync(reg.root);
      expect(st.isDirectory()).toBe(true);
      expect(st.isSymbolicLink()).toBe(false);
    });

    it('admission created no Data/ directory and no agnt.db (D4 — no pre-creation)', () => {
      // This file imports ONLY the context module: nothing has run the open
      // pipeline, so a pre-created database here could only be an admission
      // side effect — which D4 forbids.
      const reg = globalThis[KEY_V3];
      expect(fs.existsSync(path.join(reg.root, 'Data'))).toBe(false);
      expect(fs.existsSync(path.join(reg.root, 'Data', 'agnt.db'))).toBe(false);
      expect(fs.existsSync(path.join(reg.root, 'agnt.db'))).toBe(false);
    });
  });

  // ==========================================================================
  // v3 storage context — negatives + documented residual (A0 P2 block, kept
  // green through the v3-only activation). R03 re-scope note (C9): the final
  // case asserts the DOCUMENTED trusted-mode residual — a fully consistent
  // context built by hand under admittedParent IS accepted, because
  // structural validation is coordination, not authority. Enforced mode
  // (Stage D) is the only closure of that residual; it is not claimed solved.
  // ==========================================================================
  describe('v3 storage context', () => {
    const v3Code = (fn) => {
      try { fn(); } catch (e) { return e && e.code ? e.code : 'NO_CODE'; }
      return 'NO_THROW';
    };
    const tmpParent = () => fs.realpathSync(os.tmpdir());
    const scratchDirs = [];

    const mkScratch = (prefix) => {
      const d = fs.mkdtempSync(path.join(tmpParent(), prefix));
      scratchDirs.push(d);
      return d;
    };

    afterAll(() => {
      for (const d of scratchDirs) {
        try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
      }
    });

    it('initializes idempotently and reuses the same registration object', () => {
      const a = initializeTestStorage();
      const b = initializeTestStorage();
      expect(b).toBe(a);
      expect(initializeTestStorageV3()).toBe(a); // A0-era alias, same implementation
      expect(a.root.startsWith(path.join(tmpParent(), 'agnt-v3-'))).toBe(true);
      // No agnt.db pre-creation (D4) and no Data/ creation at admission time.
      expect(fs.existsSync(path.join(a.root, 'agnt.db'))).toBe(false);
      expect(fs.existsSync(path.join(a.root, 'Data'))).toBe(false);
    });

    it('refuses a wrong-pid registration (R03 negative)', () => {
      const saved = globalThis[KEY_V3];
      globalThis[KEY_V3] = Object.freeze({ ...saved, pid: 999999 });
      try {
        expect(getStorageContext).toThrowError(TestStorageError);
        expect(v3Code(() => getStorageContext())).toBe('AGNT_TEST_STORAGE_PID_MISMATCH');
      } finally { globalThis[KEY_V3] = saved; }
    });

    it('refuses a mutated (unfrozen) registration copy (R03 negative)', () => {
      const saved = globalThis[KEY_V3];
      globalThis[KEY_V3] = { ...saved };
      try {
        expect(v3Code(() => getStorageContext())).toBe('AGNT_TEST_STORAGE_MUTATED');
      } finally { globalThis[KEY_V3] = saved; }
    });

    it('refuses identity drift when root identity does not match the filesystem (R03 negative)', () => {
      const saved = globalThis[KEY_V3];
      const other = mkScratch('agnt-v3-drift-');
      // Registration points at `other` but still carries the ORIGINAL
      // rootIdentity: dev/ino cannot match two different directories.
      globalThis[KEY_V3] = Object.freeze({ ...saved, root: other, admittedRoots: Object.freeze([other]) });
      try {
        expect(v3Code(() => getStorageContext())).toBe('AGNT_TEST_STORAGE_IDENTITY_DRIFT');
      } finally { globalThis[KEY_V3] = saved; }
    });

    it('refuses admitTestRoot outside the frozen admittedParent (zero fs effects)', () => {
      const outside = path.join(os.homedir(), 'agnt-admit-refused-nonexistent');
      expect(v3Code(() => admitTestRoot(outside))).toBe('AGNT_TEST_STORAGE_ESCAPE');
      expect(fs.existsSync(outside)).toBe(false);
    });

    it('refuses admitTestRoot on a symlinked path (R05-class negative)', () => {
      const real = mkScratch('agnt-v3-alias-real-');
      const link = path.join(tmpParent(), 'agnt-v3-alias-link-' + process.pid);
      try { fs.symlinkSync(real, link); } catch {}
      try {
        expect(v3Code(() => admitTestRoot(link))).toBe('AGNT_TEST_STORAGE_ALIAS');
      } finally {
        try { fs.rmSync(link, { force: true }); } catch {}
      }
    });

    it('two module instances accept the same valid context (R02 core, module-level)', async () => {
      const a = initializeTestStorage();
      const mod = new URL('../../../backend/src/utils/testStorageContext.js', import.meta.url);
      const instanceA = await import(`${mod.href}?v3inst=a`);
      const instanceB = await import(`${mod.href}?v3inst=b`);
      // Distinct module instances, same global registration: nothing in
      // validation references the validating module (no function token).
      expect(instanceA.getStorageContext()).toBe(a);
      expect(instanceB.getStorageContext()).toBe(a);
      expect(instanceA.initializeTestStorage()).toBe(a);
      expect(instanceB.getStorageContext().root).toBe(a.root);
    });

    it('refuses resetTestStorage while a storage handle is registered (R09-cache)', () => {
      const ctx = getStorageContext();
      registerStorageHandle(ctx.root, () => {});
      try {
        expect(v3Code(() => resetTestStorage())).toBe('AGNT_TEST_STORAGE_HANDLE_OPEN');
      } finally { releaseStorageHandle(ctx.root); }
      const next = resetTestStorage();
      expect(next.generation).toBe(ctx.generation + 1);
      expect(next.orphanedRoots).toContain(ctx.root);
      expect(next.root).not.toBe(ctx.root);
      // The orphaned root is never deleted by the context module.
      expect(fs.existsSync(ctx.root)).toBe(true);
      scratchDirs.push(ctx.root);
    });

    it('accepts a fully consistent hand-built context — the DOCUMENTED trusted-mode residual (C9/D3)', () => {
      // This context is NOT created by initializeTestStorage: every field
      // is constructed by hand, correctly, under the frozen admittedParent.
      // Structural validation MUST accept it, because admitTestRoot() grants
      // the same power to any test. This is the honest coordination boundary
      // (contract §2); hostile-code confinement is enforced-mode only
      // (Stage D) and is NOT claimed prevented here.
      const saved = globalThis[KEY_V3];
      const forged = mkScratch('agnt-v3-forged-');
      const st = fs.lstatSync(forged);
      const hand = Object.freeze({
        root: forged,
        rootIdentity: Object.freeze({ dev: st.dev, ino: st.ino }),
        admittedParent: tmpParent(),
        admittedRoots: Object.freeze([forged]),
        pid: process.pid,
        ppid: process.ppid,
        runId: 'hand-forged-consistent',
        generation: 1,
        bootRole: 'owner',
        sharedStore: null,
        orphanedRoots: Object.freeze([]),
        init: Object.freeze({ state: 'uninitialized', error: null }),
        createdAt: Date.now(),
      });
      globalThis[KEY_V3] = hand;
      try {
        expect(getStorageContext()).toBe(hand);
      } finally { globalThis[KEY_V3] = saved; }
    });
  });

  // ==========================================================================
  // PR145 A1 regressions (absorbed from the verification findings; the
  // storageContextReset red-first file remains pending new-file consent).
  // ==========================================================================
  describe('A1 regressions (FV-1/FV-2/FV-8)', () => {
    const v3Code = (fn) => {
      try { fn(); } catch (e) { return e && e.code ? e.code : 'NO_CODE'; }
      return 'NO_THROW';
    };

    it('FV-1: resetTestStorage is refused ACROSS module instances while a handle is open', async () => {
      // Instance A registers a handle on the active root; a DIFFERENT module
      // instance must still see it (the registry is process-global, not
      // module-instance state) and refuse the reset.
      const mod = new URL('../../../backend/src/utils/testStorageContext.js', import.meta.url);
      const instanceA = await import(`${mod.href}?fv1=a`);
      const instanceB = await import(`${mod.href}?fv1=b`);
      const ctx = instanceA.getStorageContext();
      instanceA.registerStorageHandle(ctx.root, () => {});
      try {
        expect(v3Code(() => instanceB.resetTestStorage())).toBe('AGNT_TEST_STORAGE_HANDLE_OPEN');
        expect(v3Code(() => instanceB.admitTestRoot(ctx.root))).toBe('AGNT_TEST_STORAGE_HANDLE_OPEN');
      } finally {
        instanceA.releaseStorageHandle(ctx.root);
      }
      // After release, the other instance's reset proceeds.
      const next = instanceB.resetTestStorage();
      expect(next.generation).toBe(ctx.generation + 1);
    });

    it('FV-2: initializeTestStorage REFUSES a tampered registration (DEC-1 refuse-don’t-replace)', () => {
      const saved = globalThis[KEY_V3];
      const tampered = { ...saved }; // unfrozen copy — structurally invalid
      globalThis[KEY_V3] = tampered;
      try {
        expect(() => initializeTestStorage()).toThrowError(TestStorageError);
        expect(v3Code(() => initializeTestStorage())).toBe('AGNT_TEST_STORAGE_MUTATED');
        // Refused, NOT replaced: the tampered object is still the
        // registration, and no fresh root was allocated over it.
        expect(globalThis[KEY_V3]).toBe(tampered);
      } finally { globalThis[KEY_V3] = saved; }
      // Explicit recovery still works (valid registration → reuse).
      expect(initializeTestStorage()).toBe(saved);
    });

    it('FV-8: the fresh-allocation tmpdir parent is cached once per process and shared across instances', async () => {
      const KEY_TMPARENT = Symbol.for('agnt.test.storage.v3.tmparent');
      const mod = new URL('../../../backend/src/utils/testStorageContext.js', import.meta.url);
      const instanceA = await import(`${mod.href}?fv8=a`);
      const instanceB = await import(`${mod.href}?fv8=b`);
      const ctx = instanceA.getStorageContext();
      // The per-process cache exists, matches the real tmpdir, and both the
      // active root and a reset-allocated root from EITHER instance live
      // under it.
      expect(typeof globalThis[KEY_TMPARENT]).toBe('string');
      expect(globalThis[KEY_TMPARENT]).toBe(fs.realpathSync(os.tmpdir()));
      expect(ctx.admittedParent).toBe(globalThis[KEY_TMPARENT]);
      const next = instanceB.resetTestStorage();
      expect(next.admittedParent).toBe(globalThis[KEY_TMPARENT]);
      expect(next.root.startsWith(globalThis[KEY_TMPARENT])).toBe(true);
    });
  });

  // ==========================================================================
  // PR145 BUGFIX-20260913 — REVIEW-20260913 regressions that belong in the
  // SETUP-admitted vitest process (RV-5 option mismatch, RV-6 handle path
  // containment, T9/DEC-2 launcher mirror drift). The RV-1/RV-2/RV-3/RV-4
  // and T5/T6/T7 cases live in tests/unit/storage/*.test.js under node:test
  // (private admitted parents there make allocation counting exact).
  // ==========================================================================
  describe('RV regressions (REVIEW-20260913)', () => {
    const v3Code = (fn) => {
      try { fn(); } catch (e) { return e && e.code ? e.code : 'NO_CODE'; }
      return 'NO_THROW';
    };

    it('RV-5: initializeTestStorage({sharedStore}) against the live same-pid registration is refused, not silently ignored', () => {
      const before = globalThis[KEY_V3];
      const shared = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'agnt-rv5-vitest-'));
      try {
        expect(v3Code(() => initializeTestStorage({
          sharedStore: { root: shared, parentPid: process.ppid, runId: 'rv5', generation: 1, policy: 'parent-exit' },
        }))).toBe('AGNT_TEST_STORAGE_OPTION_MISMATCH');
      } finally {
        try { fs.rmSync(shared, { recursive: true, force: true }); } catch {}
      }
      expect(globalThis[KEY_V3]).toBe(before); // refused, nothing replaced
      expect(initializeTestStorage()).toBe(before); // plain reuse stays idempotent
    });

    it('RV-6: handle registration outside the admitted parent is refused (typed ESCAPE)', () => {
      // The admitted parent IS realpath(os.tmpdir()) in this worker, so a
      // truly-outside path must be a SIBLING of it (still on the synthetic
      // tmpfs run root — no real filesystem location is touched; the ESCAPE
      // check fires before any lstat).
      const admittedParent = getStorageContext().admittedParent;
      const outside = path.join(path.dirname(admittedParent), 'agnt-rv6-vitest-outside-' + process.pid);
      expect(v3Code(() => registerStorageHandle(outside, () => {}))).toBe('AGNT_TEST_STORAGE_ESCAPE');
      expect(v3Code(() => releaseStorageHandle(outside))).toBe('AGNT_TEST_STORAGE_ESCAPE');
    });

    it('T9/DEC-2: admitTestRoot does NOT rewrite the setup-exported legacy mirrors (set-once)', () => {
      const setupRoot = process.env.USER_DATA_PATH;
      const setupNonce = process.env.__AGNT_TEST_DATA_DIR;
      const savedReg = getStorageContext();
      const scratch = fs.mkdtempSync(path.join(savedReg.admittedParent, 'agnt-t9-'));
      try {
        const switched = admitTestRoot(scratch);
        expect(getStorageContext().root).toBe(scratch);
        expect(switched.admittedRoots).toContain(savedReg.root);
        // DEC-2: the mirrors still represent the SETUP admission — a root
        // switch must not silently repoint direct env readers.
        expect(process.env.USER_DATA_PATH).toBe(setupRoot);
        expect(process.env.__AGNT_TEST_DATA_DIR).toBe(setupNonce);
      } finally {
        globalThis[KEY_V3] = savedReg; // restore the setup admission exactly
        try { fs.rmSync(scratch, { recursive: true, force: true }); } catch {}
      }
      expect(process.env.USER_DATA_PATH).toBe(setupRoot);
    });
  });
});
