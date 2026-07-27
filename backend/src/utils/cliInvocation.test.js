/**
 * cliInvocation — Windows resolution for the subscription-CLI connectors.
 *
 * Verified against the real installer layouts on 2026-07-27:
 *   grok   0.2.112 → %USERPROFILE%\.grok\bin\grok.exe (real executable)
 *   cursor 2026.07.23-e383d2b → %LOCALAPPDATA%\cursor-agent\cursor-agent.cmd
 *          shim over versions\<ver>\node.exe + index.js
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveCursorInvocation, grokBinCandidates } from './cliInvocation.js';

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-invoke-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeCursorInstall(root, versions) {
  for (const v of versions) {
    const dir = path.join(root, 'versions', v);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'node.exe'), '');
    fs.writeFileSync(path.join(dir, 'index.js'), '');
  }
  fs.writeFileSync(path.join(root, 'cursor-agent.cmd'), '@echo off');
}

describe('resolveCursorInvocation — win32', () => {
  it('resolves the latest version dir to a direct node.exe invocation', () => {
    const root = path.join(tmp, 'cursor-agent');
    makeCursorInstall(root, ['2026.07.23-e383d2b', '2026.1.5-abc123']);
    const inv = resolveCursorInvocation({
      platform: 'win32',
      env: { LOCALAPPDATA: tmp },
      homedir: tmp,
    });
    expect(inv.command).toBe(path.join(root, 'versions', '2026.07.23-e383d2b', 'node.exe'));
    expect(inv.args).toEqual([path.join(root, 'versions', '2026.07.23-e383d2b', 'index.js')]);
  });

  it('orders single-digit months/days correctly (numeric, not lexicographic)', () => {
    // Lexicographically '2026.10.1' < '2026.9.9'; numerically it is newer.
    const root = path.join(tmp, 'cursor-agent');
    makeCursorInstall(root, ['2026.9.9-aaa111', '2026.10.1-bbb222']);
    const inv = resolveCursorInvocation({ platform: 'win32', env: { LOCALAPPDATA: tmp }, homedir: tmp });
    expect(inv.command).toContain('2026.10.1-bbb222');
  });

  it('supports the newer timestamped version format', () => {
    const root = path.join(tmp, 'cursor-agent');
    makeCursorInstall(root, ['2026.07.23-12-30-00-e383d2b']);
    const inv = resolveCursorInvocation({ platform: 'win32', env: { LOCALAPPDATA: tmp }, homedir: tmp });
    expect(inv.command).toContain('2026.07.23-12-30-00-e383d2b');
  });

  it('never returns a .cmd shim: an AGNT_CURSOR_BIN pointing at one is re-derived', () => {
    const root = path.join(tmp, 'cursor-agent');
    makeCursorInstall(root, ['2026.07.23-e383d2b']);
    const inv = resolveCursorInvocation({
      platform: 'win32',
      env: { AGNT_CURSOR_BIN: path.join(root, 'cursor-agent.cmd'), LOCALAPPDATA: tmp },
      homedir: tmp,
    });
    expect(inv.command).toMatch(/node\.exe$/);
    expect(inv.args[0]).toMatch(/index\.js$/);
  });

  it('falls back to PATH lookup when nothing is installed', () => {
    const inv = resolveCursorInvocation({ platform: 'win32', env: { LOCALAPPDATA: path.join(tmp, 'nope') }, homedir: tmp });
    expect(inv).toEqual({ command: 'cursor-agent', args: [] });
  });

  it('ignores version dirs missing their payload', () => {
    const root = path.join(tmp, 'cursor-agent');
    fs.mkdirSync(path.join(root, 'versions', '2026.07.25-fff999'), { recursive: true }); // empty
    makeCursorInstall(root, ['2026.07.23-e383d2b']);
    const inv = resolveCursorInvocation({ platform: 'win32', env: { LOCALAPPDATA: tmp }, homedir: tmp });
    expect(inv.command).toContain('2026.07.23-e383d2b');
  });
});

describe('resolveCursorInvocation — posix (unchanged behaviour)', () => {
  it('returns a bare existing candidate with no args prefix', () => {
    const local = path.join(tmp, '.local', 'bin');
    fs.mkdirSync(local, { recursive: true });
    fs.writeFileSync(path.join(local, 'cursor-agent'), '#!/bin/sh');
    const inv = resolveCursorInvocation({ platform: 'linux', env: {}, homedir: tmp });
    expect(inv).toEqual({ command: path.join(tmp, '.local/bin/cursor-agent'), args: [] });
  });

  it('honours AGNT_CURSOR_BIN verbatim with ~ expansion', () => {
    const inv = resolveCursorInvocation({
      platform: 'linux',
      env: { AGNT_CURSOR_BIN: '~/bin/cursor-agent' },
      homedir: tmp,
    });
    expect(inv).toEqual({ command: path.join(tmp, 'bin', 'cursor-agent'), args: [] });
  });
});

describe('grokBinCandidates', () => {
  it('includes grok.exe candidates on win32', () => {
    const c = grokBinCandidates({ platform: 'win32', homedir: 'C:\\Users\\t' });
    expect(c).toContain(path.join('C:\\Users\\t', '.grok', 'bin', 'grok.exe'));
    expect(c.some((p) => p.includes('homebrew'))).toBe(false);
  });

  it('keeps the POSIX list intact elsewhere', () => {
    const c = grokBinCandidates({ platform: 'darwin', homedir: '/Users/t' });
    expect(c).toContain('/opt/homebrew/bin/grok');
    expect(c).toContain(path.join('/Users/t', '.grok', 'bin', 'grok'));
    expect(c.some((p) => p.endsWith('.exe'))).toBe(false);
  });
});
