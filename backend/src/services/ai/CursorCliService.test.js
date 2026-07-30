/**
 * Unit tests for CursorCliService (no live CLI spawn).
 *
 * Covers the pure, deterministic surface: public API shape, input validation
 * (empty prompt rejects before any spawn), and binary/workdir/default-model
 * resolution incl. env overrides. The heavy headless path (spawn `cursor-agent`,
 * parse-and-kill on the first {"type":"result"} object, timeout) is an
 * integration concern exercised end-to-end elsewhere.
 */
import { describe, it, expect } from 'vitest';
import os from 'os';
import path from 'path';
import CursorCliService from './CursorCliService.js';

describe('CursorCliService', () => {
  it('exposes the expected public API', () => {
    for (const fn of ['getDefaultModel', 'getDefaultWorkdir', 'getDefaultTimeoutMs', 'resolveCursorBin', 'checkAuth', 'runExec']) {
      expect(typeof CursorCliService[fn]).toBe('function');
    }
  });

  it('getDefaultTimeoutMs returns a finite positive number (never NaN)', () => {
    const t = CursorCliService.getDefaultTimeoutMs();
    expect(Number.isFinite(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });

  it('runExec rejects an empty/blank/missing prompt before spawning anything', async () => {
    await expect(CursorCliService.runExec({ prompt: '' })).rejects.toThrow(/prompt is required/i);
    await expect(CursorCliService.runExec({ prompt: '   ' })).rejects.toThrow(/prompt is required/i);
    await expect(CursorCliService.runExec({})).rejects.toThrow(/prompt is required/i);
  });

  it('getDefaultModel returns a non-empty string', () => {
    const m = CursorCliService.getDefaultModel();
    expect(typeof m).toBe('string');
    expect(m.length).toBeGreaterThan(0);
  });

  it('getDefaultWorkdir returns a sandbox path under the home dir by default', () => {
    const prev = process.env.AGNT_CURSOR_WORKDIR;
    delete process.env.AGNT_CURSOR_WORKDIR;
    const wd = CursorCliService.getDefaultWorkdir();
    expect(wd.startsWith(os.homedir())).toBe(true);
    expect(/agnt-cursor-work$/.test(wd)).toBe(true);
    if (prev !== undefined) process.env.AGNT_CURSOR_WORKDIR = prev;
  });

  it('resolveCursorBin honors AGNT_CURSOR_BIN override (with ~ expansion)', () => {
    const prev = process.env.AGNT_CURSOR_BIN;
    process.env.AGNT_CURSOR_BIN = '~/custom/bin/cursor-agent';
    expect(CursorCliService.resolveCursorBin()).toBe(path.join(os.homedir(), 'custom/bin/cursor-agent'));
    if (prev !== undefined) process.env.AGNT_CURSOR_BIN = prev; else delete process.env.AGNT_CURSOR_BIN;
  });

  it('resolveCursorBin returns an absolute override path as-is', () => {
    const prev = process.env.AGNT_CURSOR_BIN;
    process.env.AGNT_CURSOR_BIN = '/nonexistent/path/does/not/exist-xyz/cursor-agent';
    expect(CursorCliService.resolveCursorBin()).toBe('/nonexistent/path/does/not/exist-xyz/cursor-agent');
    if (prev !== undefined) process.env.AGNT_CURSOR_BIN = prev; else delete process.env.AGNT_CURSOR_BIN;
  });
});
