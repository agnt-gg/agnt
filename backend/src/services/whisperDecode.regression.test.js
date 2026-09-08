import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
vi.mock('../utils/PathManager.js', () => ({ default: {} }));
const { whisperService } = await import('./whisperService.js');

// Genuine RIFF fixture with an odd-sized ancillary chunk: PCM never starts at 44.
function wav(samples, channels = 1, sampleRate = 16000) {
  const fmt = Buffer.alloc(24);
  fmt.write('fmt '); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(channels, 10); fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * channels * 2, 16);
  fmt.writeUInt16LE(channels * 2, 20); fmt.writeUInt16LE(16, 22);
  const junk = Buffer.from([74,85,78,75,3,0,0,0,9,8,7,0]);
  const data = Buffer.alloc(8 + samples.length * 2);
  data.write('data'); data.writeUInt32LE(samples.length * 2, 4);
  samples.forEach((s, i) => data.writeInt16LE(s, 8 + i * 2));
  const header = Buffer.alloc(12); header.write('RIFF');
  header.writeUInt32LE(4 + fmt.length + junk.length + data.length, 4); header.write('WAVE', 8);
  return Buffer.concat([header, fmt, junk, data]);
}

async function fixture(name, bytes, check) {
  // Mission runner supplies TMPDIR inside its allowed evidence directory.
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whisper-decode-'));
  const file = path.join(dir, name);
  await fs.writeFile(file, bytes);
  await check(file);
}

describe('real ffmpeg decode, no model or microphone', () => {
  it('decodes an uploaded WAV and preserves every input byte', async () => {
    const samples = [0, 16384, -16384, 32767, -32768, 8192];
    const input = wav(samples);
    await fixture('utterance.wav', input, async (file) => {
      const output = await whisperService.decodeAudio(file);
      expect([...output]).toEqual(samples.map(s => s / 32768));
      expect(await fs.readFile(file)).toEqual(input);
    });
  });

  it('honors RIFF chunks even with a different extension and shell punctuation', async () => {
    const samples = Array.from({ length: 1600 }, (_, i) => (i % 2 ? -12000 : 12000));
    const input = wav(samples);
    await fixture('utterance $literal; safe.input', input, async (file) => {
      const output = await whisperService.decodeAudio(file);
      expect(output.length).toBe(samples.length);
      expect([...output]).toEqual(samples.map(s => s / 32768));
      expect(await fs.readFile(file)).toEqual(input);
    });
  });

  it('parses ancillary RIFF chunks independently of extension and preserves a sibling WAV', async () => {
    const samples = [8192, -8192, 0, 16384];
    const input = wav(samples);
    await fixture('plain.input', input, async (file) => {
      const sibling = file.replace(/\.input$/, '.wav');
      const sentinel = Buffer.from('unrelated sibling must stay intact');
      await fs.writeFile(sibling, sentinel);
      const output = await whisperService.decodeAudio(file);
      expect([...output]).toEqual(samples.map(s => s / 32768));
      expect(await fs.readFile(file)).toEqual(input);
      expect(await fs.readFile(sibling)).toEqual(sentinel);
    });
  });

  it('keeps malformed WAV input on decoder failure', async () => {
    const input = Buffer.from('not a WAV');
    await fixture('broken.wav', input, async (file) => {
      await expect(whisperService.decodeAudio(file)).rejects.toThrow();
      expect(await fs.readFile(file)).toEqual(input);
    });
  });

  it('resamples real stereo 48k PCM to mono 16k', async () => {
    const input = wav(Array(9600).fill(8192), 2, 48000);
    await fixture('stereo.wav', input, async (file) => {
      const output = await whisperService.decodeAudio(file);
      expect(output.length).toBe(1600);
      expect(output[800]).toBeCloseTo(0.25, 4);
      expect(await fs.readFile(file)).toEqual(input);
    });
  });
});
