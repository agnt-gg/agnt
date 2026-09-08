import { it, expect, vi } from 'vitest';
const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }));
vi.mock('child_process', async () => {
  const { promisify } = await import('node:util');
  // Node execFile has custom promisification returning {stdout, stderr}; a
  // plain callback mock would incorrectly resolve just the stdout Buffer.
  execFile[promisify.custom] = (...args) => new Promise((resolve, reject) => {
    execFile(...args, (error, stdout, stderr) => error ? reject(error) : resolve({ stdout, stderr }));
  });
  return { execFile };
});
vi.mock('../utils/PathManager.js', () => ({ default: {} }));
const { whisperService } = await import('./whisperService.js');

it('uses a bounded binary pipe, fixed argv, no shell and no writable output file', async () => {
  execFile.mockImplementation((bin, args, options, cb) => cb(null, Buffer.from([0,64]), Buffer.alloc(0)));
  const file = '/unit-only/utterance $literal;safe.wav';
  expect([...(await whisperService.decodeAudio(file))]).toEqual([0.5]);
  const [, args, options] = execFile.mock.calls.at(-1);
  expect(args).toEqual(['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,pipe',
    '-threads', '1', '-i', file, '-map', '0:a:0', '-vn', '-threads', '1', '-ar', '16000', '-ac', '1',
    '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1']);
  expect(options).toEqual({ encoding: 'buffer', timeout: 30000, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL', windowsHide: true });
});
it.each([Buffer.alloc(0), Buffer.from([0])])('rejects empty or incomplete PCM', async bytes => {
  execFile.mockImplementation((bin, args, options, cb) => cb(null, bytes, Buffer.alloc(0)));
  await expect(whisperService.decodeAudio('/unit-only/input.wav')).rejects.toThrow('empty or incomplete PCM');
});
it('propagates a decoder timeout rather than transcribing partial stdout', async () => {
  execFile.mockImplementation((bin, args, options, cb) => cb(new Error('timed out'), Buffer.from([0,64]), Buffer.alloc(0)));
  await expect(whisperService.decodeAudio('/unit-only/input.wav')).rejects.toThrow('timed out');
});
