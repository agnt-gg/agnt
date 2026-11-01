import { describe, it, expect, beforeEach } from 'vitest';
import path from 'path';
import { findExecutable, hiddenOnThisInstance, isMissingProgramError, notInstalledMessage, HOSTED_TOOL_PATH, _resetHostedPresenceForTests } from './localCliTools.js';

/**
 * Bravo, 2026-10-31: codex_exec, cursor_exec, grok_exec and computer_use were offered on a hosted
 * instance whose image has none of their programs; cursor_exec and grok_exec reported the missing
 * program as "not authenticated".
 */
beforeEach(() => _resetHostedPresenceForTests());

describe('local CLI tools', () => {
  it('on a hosted instance a tool is offered only when its program is on the sandbox PATH', () => {
    const asked = [];
    const find = (bin, { envPath }) => { asked.push([bin, envPath]); return bin === 'codex' ? '/usr/local/bin/codex' : null; };
    expect(hiddenOnThisInstance('codex_exec', { hosted: true, find })).toBe(false);
    for (const tool of ['cursor_exec', 'grok_exec', 'computer_use']) expect(hiddenOnThisInstance(tool, { hosted: true, find }), tool).toBe(true);
    expect(asked.every(([, envPath]) => envPath === HOSTED_TOOL_PATH)).toBe(true);
  });

  it('never hides anything on a desktop, and never hides other tools', () => {
    const find = () => null;
    expect(hiddenOnThisInstance('cursor_exec', { hosted: false, find })).toBe(false);
    expect(hiddenOnThisInstance('web_search', { hosted: true, find })).toBe(false);
  });

  it('a missing program reads as not installed, naming the program', () => {
    expect(isMissingProgramError('spawn cursor-agent ENOENT')).toBe(true);
    expect(isMissingProgramError({ code: 'ENOENT' })).toBe(true);
    expect(isMissingProgramError('Not logged in')).toBe(false);
    expect(notInstalledMessage('cursor_exec')).toMatch(/Cursor Agent CLI is not installed.*cursor-agent/);
  });

  it('findExecutable searches PATH, with Windows extensions only on Windows', () => {
    const files = new Set([path.join('/opt/bin', 'grok'), path.join('C:/tools', 'codex.cmd')]);
    const exists = (p) => files.has(p);
    expect(findExecutable('grok', { envPath: '/usr/bin:/opt/bin', exists, platform: 'linux', delimiter: ':' })).toBe(path.join('/opt/bin', 'grok'));
    expect(findExecutable('codex', { envPath: 'C:/tools', exists, platform: 'win32', delimiter: ';' })).toBe(path.join('C:/tools', 'codex.cmd'));
    expect(findExecutable('codex', { envPath: 'C:/tools', exists, platform: 'linux', delimiter: ':' })).toBeNull();
  });
});
