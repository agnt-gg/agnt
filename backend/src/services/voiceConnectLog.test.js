import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createVoiceConnectLog } from './voiceConnectLog.js';

/**
 * The voice connect timings used to reach console only, and Electron never
 * writes the backend's console to disk — so a slow "Connecting…" could only be
 * diagnosed by reproducing it. These pin that the lines now persist, stay
 * bounded, and can never break the caller.
 */
let dir;
let file;
const fixedNow = () => new Date('2026-09-23T12:00:00.000Z');

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-connect-log-'));
  file = path.join(dir, 'logs', 'voice-connect.log');
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('voiceConnectLog', () => {
  it('creates the folder and writes one timestamped line per entry', async () => {
    const log = createVoiceConnectLog({ file, now: fixedNow });
    await log.append('[speech] realtime connect outcome=connected total=640ms');
    await log.append('[speech] realtime call route=api.openai.com 164ms ok');

    expect(fs.readFileSync(file, 'utf8')).toBe(
      '2026-09-23T12:00:00.000Z [speech] realtime connect outcome=connected total=640ms\n' +
        '2026-09-23T12:00:00.000Z [speech] realtime call route=api.openai.com 164ms ok\n',
    );
  });

  it('an embedded newline cannot forge a second entry', async () => {
    const log = createVoiceConnectLog({ file, now: fixedNow });
    await log.append('one\r\n2026-01-01T00:00:00.000Z forged');
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('rolls to .1 once full, keeping exactly one previous generation', async () => {
    const log = createVoiceConnectLog({ file, maxBytes: 60, now: fixedNow });
    await log.append('first entry that fills most of the budget.....');
    await log.append('second entry lands in a fresh file');
    await log.append('third entry rolls the second one over');

    expect(fs.readFileSync(`${file}.1`, 'utf8')).toContain('second entry');
    expect(fs.readFileSync(file, 'utf8')).toContain('third entry');
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(['voice-connect.log', 'voice-connect.log.1']);
  });

  it('concurrent appends all land, whole and in order', async () => {
    const log = createVoiceConnectLog({ file, now: fixedNow });
    await Promise.all(Array.from({ length: 25 }, (_, i) => log.append(`entry-${i}`)));
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    expect(lines.map((l) => l.split(' ')[1])).toEqual(Array.from({ length: 25 }, (_, i) => `entry-${i}`));
  });

  it('an unwritable log warns once and never rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A FILE where the folder must go: mkdir fails on every platform.
    fs.writeFileSync(path.join(dir, 'logs'), 'not a directory');
    const log = createVoiceConnectLog({ file, now: fixedNow });

    await expect(log.append('a')).resolves.toBeUndefined();
    await expect(log.append('b')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
