import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Recorder } from './Recorder.js';
import { installConsoleBridge } from './consoleBridge.js';
import { consolePassthroughFromEnv } from './install.js';

/**
 * A child whose parent is not echoing its output passes only warnings and
 * errors to its real (piped) stdout/stderr. On Windows a pipe write blocks
 * until the parent reads, and boot-time chatter through that pipe froze the
 * backend's event loop for tens of seconds. The diagnostics log still gets
 * every line.
 */

const dirs = [];
function recorderInTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-bridge-'));
  dirs.push(dir);
  return { dir, recorder: new Recorder({ dir, proc: 'backend', level: 'TRACE' }) };
}
function fakeConsole() {
  const seen = [];
  const target = {};
  for (const m of ['log', 'info', 'warn', 'error', 'debug', 'trace']) target[m] = (...a) => seen.push([m, a.join(' ')]);
  return { seen, target };
}
const recordedLines = (dir) =>
  fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim().split('\n'))
    .filter(Boolean).map((l) => JSON.parse(l));

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("consoleBridge passthrough: 'warn'", () => {
  it('passes only warnings and errors through, and still records everything', () => {
    const { dir, recorder } = recorderInTempDir();
    const { seen, target } = fakeConsole();
    const off = installConsoleBridge(recorder, { target, passthrough: 'warn' });

    target.log('plugin chatter');
    target.info('info chatter');
    target.debug('debug chatter');
    target.warn('a warning');
    target.error('an error');
    off();
    recorder.close();

    expect(seen.map(([m]) => m)).toEqual(['warn', 'error']);
    const messages = recordedLines(dir).map((r) => r.msg);
    for (const text of ['plugin chatter', 'info chatter', 'a warning', 'an error']) {
      expect(messages.some((m) => String(m).includes(text)), text).toBe(true);
    }
  });

  it('keeps full passthrough by default, so a terminal run is unchanged', () => {
    const { recorder } = recorderInTempDir();
    const { seen, target } = fakeConsole();
    const off = installConsoleBridge(recorder, { target });
    target.log('visible');
    off();
    recorder.close();
    expect(seen).toEqual([['log', 'visible']]);
  });

  it('reads the mode from AGNT_CONSOLE_PASSTHROUGH, defaulting to everything', () => {
    // `undefined` falls through to the parameter default, which READS the env.
    // A suite started from inside AGNT inherits AGNT_CONSOLE_PASSTHROUGH=warn,
    // so the unset case must be made unset, not assumed.
    const inherited = process.env.AGNT_CONSOLE_PASSTHROUGH;
    delete process.env.AGNT_CONSOLE_PASSTHROUGH;
    try {
      expect(consolePassthroughFromEnv(undefined)).toBe(true);
      expect(consolePassthroughFromEnv()).toBe(true);
    } finally {
      if (inherited !== undefined) process.env.AGNT_CONSOLE_PASSTHROUGH = inherited;
    }
    expect(consolePassthroughFromEnv('all')).toBe(true);
    expect(consolePassthroughFromEnv('warn')).toBe('warn');
    expect(consolePassthroughFromEnv('none')).toBe(false);
  });
});
