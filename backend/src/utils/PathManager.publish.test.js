/**
 * AGNT publishes the folders it resolved, for plugins (AGNT_ROOT_DIR,
 * AGNT_DATA_DIR). A plugin that guessed instead saved its images where the
 * image route never looks (Atlas Cloud under AGNT One, reported 2026-10-20).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const saved = { ...process.env };
afterEach(() => {
  for (const key of ['USER_DATA_PATH', 'AGNT_HOME', 'AGNT_ROOT_DIR', 'AGNT_DATA_DIR']) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
  vi.resetModules();
});

async function freshPathManager(env) {
  vi.resetModules();
  delete process.env.USER_DATA_PATH;
  delete process.env.AGNT_HOME;
  delete process.env.AGNT_ROOT_DIR;
  delete process.env.AGNT_DATA_DIR;
  Object.assign(process.env, env);
  return (await import('./PathManager.js')).default;
}

describe('PathManager publishes what it resolved', () => {
  it('an Electron profile other than the default (AGNT One): <profile>/Data', async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-profile-'));
    try {
      const pm = await freshPathManager({ USER_DATA_PATH: profile });
      expect(process.env.AGNT_ROOT_DIR).toBe(profile);
      expect(process.env.AGNT_DATA_DIR).toBe(path.join(profile, 'Data'));
      expect(process.env.AGNT_DATA_DIR).toBe(pm.getDataDir());
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });

  it('AGNT_HOME: one collapsed folder, published twice', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-home-'));
    try {
      const pm = await freshPathManager({ AGNT_HOME: home });
      expect(process.env.AGNT_DATA_DIR).toBe(path.join(home, '.agnt', 'data'));
      expect(process.env.AGNT_ROOT_DIR).toBe(pm.getRootDir());
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it('overrides a stale value inherited from a parent process', async () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-profile-'));
    try {
      await freshPathManager({ USER_DATA_PATH: profile, AGNT_DATA_DIR: 'C:/stale/parent/Data' });
      expect(process.env.AGNT_DATA_DIR).toBe(path.join(profile, 'Data'));
    } finally {
      fs.rmSync(profile, { recursive: true, force: true });
    }
  });
});
