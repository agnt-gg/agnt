/**
 * Regression tests for the 2026-07-06 Codex integration bug report:
 *
 * 1. `codex_exec` defaulted to 'gpt-5-codex', which ChatGPT-backed Codex
 *    accounts reject ("The 'gpt-5-codex' model is not supported when using
 *    Codex with a ChatGPT account."). The default is now configurable via
 *    AGNT_CODEX_DEFAULT_MODEL, and runExecStream retries once WITHOUT a
 *    model flag (so the CLI uses the account's own default) when the
 *    requested model is rejected.
 *
 * 2. AGNT spawned children with the minimal GUI-launch PATH on macOS
 *    (/usr/bin:/bin:/usr/sbin:/sbin), hiding Homebrew/user tools like
 *    `codex` and `node`. envPath.js augments the child PATH.
 */
import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import CodexCliService from './CodexCliService.js';
import { getAugmentedPath, augmentEnvPath } from '../../utils/envPath.js';

const originalRunOnce = CodexCliService._runExecStreamOnce;

afterEach(() => {
  CodexCliService._runExecStreamOnce = originalRunOnce;
  delete process.env.AGNT_CODEX_DEFAULT_MODEL;
});

describe('CodexCliService.getDefaultModel', () => {
  it('falls back to gpt-5-codex when no env override is set', () => {
    delete process.env.AGNT_CODEX_DEFAULT_MODEL;
    expect(CodexCliService.getDefaultModel()).toBe('gpt-5-codex');
  });

  it('honors AGNT_CODEX_DEFAULT_MODEL (trimmed)', () => {
    process.env.AGNT_CODEX_DEFAULT_MODEL = '  gpt-5.5  ';
    expect(CodexCliService.getDefaultModel()).toBe('gpt-5.5');
  });

  it('ignores a whitespace-only override', () => {
    process.env.AGNT_CODEX_DEFAULT_MODEL = '   ';
    expect(CodexCliService.getDefaultModel()).toBe('gpt-5-codex');
  });
});

describe('CodexCliService.runExecStream model fallback', () => {
  it('retries exactly once without a model when the account rejects the model', async () => {
    const calls = [];
    CodexCliService._runExecStreamOnce = async (opts) => {
      calls.push(opts.model);
      if (opts.model) {
        throw new Error(
          "The 'gpt-5-codex' model is not supported when using Codex with a ChatGPT account."
        );
      }
      return { text: 'ok', exitCode: 0, usage: null, stderr: null, threadId: 't1' };
    };

    const result = await CodexCliService.runExecStream({ prompt: 'hi', model: 'gpt-5-codex' });
    expect(calls).toEqual(['gpt-5-codex', null]);
    expect(result.text).toBe('ok');
  });

  it('passes handlers through to the retry attempt', async () => {
    let sawHandlersOnRetry = false;
    const handlers = { onDelta: () => {}, onEvent: () => {} };
    CodexCliService._runExecStreamOnce = async (opts, h) => {
      if (opts.model) throw new Error('This model is not supported for your account.');
      sawHandlersOnRetry = h === handlers;
      return { text: 'ok', exitCode: 0 };
    };

    await CodexCliService.runExecStream({ prompt: 'hi', model: 'gpt-5-codex' }, handlers);
    expect(sawHandlersOnRetry).toBe(true);
  });

  it('does NOT retry unrelated errors', async () => {
    const calls = [];
    CodexCliService._runExecStreamOnce = async (opts) => {
      calls.push(opts.model);
      throw new Error('stream disconnected before completion');
    };

    await expect(
      CodexCliService.runExecStream({ prompt: 'hi', model: 'gpt-5-codex' })
    ).rejects.toThrow(/stream disconnected/);
    expect(calls).toEqual(['gpt-5-codex']);
  });

  it('does NOT retry when no model was requested (no infinite loop)', async () => {
    const calls = [];
    CodexCliService._runExecStreamOnce = async (opts) => {
      calls.push(opts.model);
      throw new Error('The model is not supported for this account.');
    };

    await expect(CodexCliService.runExecStream({ prompt: 'hi', model: null })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});

describe('envPath.getAugmentedPath', () => {
  it('never drops existing PATH entries', () => {
    const input =
      process.platform === 'win32'
        ? ['C:\\Windows\\system32', 'C:\\Windows'].join(path.delimiter)
        : ['/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(path.delimiter);
    const out = getAugmentedPath(input);
    for (const entry of input.split(path.delimiter)) {
      expect(out.split(path.delimiter)).toContain(entry);
    }
  });

  it('is a no-op on Windows and prepend-only on POSIX', () => {
    const input = '/usr/bin:/bin';
    const out = getAugmentedPath(input);
    if (process.platform === 'win32') {
      expect(out).toBe(input);
    } else {
      expect(out.endsWith(input)).toBe(true);
    }
  });

  it('is idempotent (no duplicates when applied twice)', () => {
    const once = getAugmentedPath(process.env.PATH || '');
    expect(getAugmentedPath(once)).toBe(once);
  });

  it('augmentEnvPath returns the same env object', () => {
    const env = { PATH: process.env.PATH || '' };
    expect(augmentEnvPath(env)).toBe(env);
    expect(typeof env.PATH).toBe('string');
  });
});
