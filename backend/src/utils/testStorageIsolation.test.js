// Test-storage isolation: registration gate, escape rejection, override containment.
// Tests the actual storage-context functions against hostile environments.
import { describe, it, expect } from 'vitest';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { requireTestStorage } from '../utils/testStorageContext.js';

const KEY = '__AGNT_TEST_STORAGE_REGISTRATION__';

describe('test-storage isolation contract', () => {
  describe('requireTestStorage gate', () => {
    it('has a registration (vitest setup ran)', () => {
      expect(globalThis[KEY]).toBeTruthy();
      expect(globalThis[KEY].pid).toBe(process.pid);
    });

    it('rejects AGNT_TEST_USE_REAL_DATA', () => {
      process.env.AGNT_TEST_USE_REAL_DATA = '1';
      try { expect(() => requireTestStorage()).toThrow('real-data escape refused'); }
      finally { delete process.env.AGNT_TEST_USE_REAL_DATA; }
    });

    it('rejects AGNT_HOME', () => {
      process.env.AGNT_HOME = '/tmp/fake';
      try { expect(() => requireTestStorage()).toThrow('AGNT_HOME is refused'); }
      finally { delete process.env.AGNT_HOME; }
    });

    it('rejects USER_DATA_PATH outside tmpdir', () => {
      const saved = process.env.USER_DATA_PATH;
      process.env.USER_DATA_PATH = '/etc';
      try { expect(() => requireTestStorage()).toThrow('escapes the temporary storage area'); }
      finally { process.env.USER_DATA_PATH = saved; }
    });

    it('rejects USER_DATA_PATH pointing at real home data', () => {
      const saved = process.env.USER_DATA_PATH;
      process.env.USER_DATA_PATH = os.homedir() + '/.agnt/data';
      try { expect(() => requireTestStorage()).toThrow('escapes the temporary storage area'); }
      finally { process.env.USER_DATA_PATH = saved; }
    });

    it('rejects forged registration with wrong pid', () => {
      const saved = globalThis[KEY];
      globalThis[KEY] = { ...saved, pid: 99999 };
      try { expect(() => requireTestStorage()).toThrow('no process-local setup registration'); }
      finally { globalThis[KEY] = saved; }
    });
  });

  describe('setup scrubbing', () => {
    it('host auth-switch and secret env vars are absent after setup', () => {
      expect(process.env.TRUST_REMOTE_AUTH).toBeUndefined();
      expect(process.env.TRUST_PROXY).toBeUndefined();
      expect(process.env.JWT_SECRET).toBeUndefined();
      expect(process.env.SESSION_SECRET).toBeUndefined();
      expect(process.env.ENCRYPTION_KEY).toBeUndefined();
    });
  });

  describe('registered root properties', () => {
    it('registered root is a real directory under tmpdir', () => {
      const reg = globalThis[KEY];
      expect(reg.root).toContain(path.basename(os.tmpdir()));
      const st = fs.lstatSync(reg.root);
      expect(st.isDirectory()).toBe(true);
      expect(st.isSymbolicLink()).toBe(false);
    });

    it('registered root has an empty database file', () => {
      const reg = globalThis[KEY];
      const st = fs.statSync(reg.root + '/Data/agnt.db');
      expect(st.isFile()).toBe(true);
      expect(st.size).toBe(0);
    });
  });
});
