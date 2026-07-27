/**
 * Unit tests for GrokBuildCliService parser (no live CLI spawn).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseStreamingJsonLines } from './GrokBuildCliService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'fixtures', 'grok-build-stream-sample.jsonl');

describe('parseStreamingJsonLines', () => {
  it('extracts text, sessionId, and usage from live fixture', () => {
    const raw = fs.readFileSync(fixturePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    const parsed = parseStreamingJsonLines(lines);

    expect(parsed.text).toBe('hello-agnt');
    expect(parsed.sessionId).toBe('019f9d62-d068-7213-bb61-f7248c2a00b3');
    expect(parsed.stopReason).toBe('EndTurn');
    expect(parsed.usage).toBeTruthy();
    expect(parsed.usage.total_tokens).toBe(13610);
    expect(parsed.thoughts).toContain('user');
    expect(parsed.error).toBeNull();
  });

  it('returns empty text for empty input', () => {
    const parsed = parseStreamingJsonLines([]);
    expect(parsed.text).toBe('');
    expect(parsed.sessionId).toBeNull();
  });

  it('captures error events', () => {
    const parsed = parseStreamingJsonLines([
      JSON.stringify({ type: 'error', message: 'boom' }),
    ]);
    expect(parsed.error).toBe('boom');
    expect(parsed.text).toBe('');
  });

  it('accumulates multiple text deltas', () => {
    const parsed = parseStreamingJsonLines([
      JSON.stringify({ type: 'text', data: 'hel' }),
      JSON.stringify({ type: 'text', data: 'lo' }),
      JSON.stringify({ type: 'end', sessionId: 's1', stopReason: 'EndTurn' }),
    ]);
    expect(parsed.text).toBe('hello');
    expect(parsed.sessionId).toBe('s1');
  });
});
