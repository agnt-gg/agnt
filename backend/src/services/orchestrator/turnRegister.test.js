import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { VOICE_TURN_MARKER, TEXT_TURN_MARKER, turnMarkerPrefix, markTurnContent } from './turnRegister.js';

describe('markTurnContent — the per-turn fact rides on the user message', () => {
  it('a typed turn is returned untouched (same value, not a copy)', () => {
    for (const flags of [{}, { voiceMode: false }, { voiceMode: 'false' }, { voiceMode: undefined }, { textMode: '' }, undefined]) {
      expect(markTurnContent('hello', flags)).toBe('hello');
    }
  });

  it('a spoken turn gets the voice marker line in front of the words', () => {
    expect(markTurnContent('hello', { voiceMode: true })).toBe(`${VOICE_TURN_MARKER}\n\nhello`);
    expect(markTurnContent('hello', { voiceMode: 'true' })).toBe(`${VOICE_TURN_MARKER}\n\nhello`);
  });

  it('a texted turn gets the text marker, and both come in one fixed order', () => {
    expect(markTurnContent('hi', { textMode: true })).toBe(`${TEXT_TURN_MARKER}\n\nhi`);
    expect(markTurnContent('hi', { textMode: true, voiceMode: true })).toBe(`${VOICE_TURN_MARKER}\n${TEXT_TURN_MARKER}\n\nhi`);
  });

  it('is deterministic: the same turn always produces the same bytes', () => {
    expect(markTurnContent('x', { voiceMode: true })).toBe(markTurnContent('x', { voiceMode: true }));
    expect(turnMarkerPrefix({ voiceMode: true })).toBe(turnMarkerPrefix({ voiceMode: 'true' }));
  });

  it('never marks a shape the rehydration aligner cannot restore', () => {
    const blocks = [{ type: 'text', text: 'hi' }];
    expect(markTurnContent(blocks, { voiceMode: true })).toBe(blocks);
    expect(markTurnContent('', { voiceMode: true })).toBe('');
  });
});

describe('the system prompt never depends on the input mode', () => {
  // Static guard on the assembler: if any system-prompt builder reads the
  // per-turn flags again, a spoken turn and a typed turn get different system
  // blocks, and every switch re-writes the whole cached prefix.
  it('chatConfigs and buildUnifiedPrompt do not read voiceMode or textMode', () => {
    const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const file of ['./chatConfigs.js', './system-prompts/buildUnifiedPrompt.js']) {
      const code = strip(fs.readFileSync(new URL(file, import.meta.url), 'utf8'));
      expect(code, file).not.toMatch(/\bvoiceMode\b/);
      expect(code, file).not.toMatch(/\btextMode\b/);
    }
  });
});
