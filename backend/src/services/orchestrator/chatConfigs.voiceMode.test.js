/**
 * A spoken answer and a written answer are the same answer at two lengths.
 *
 * Reading a full written answer aloud takes the detail and forces it through
 * the channel that is worst at carrying it: listening is ~150wpm, linear, and
 * cannot be skimmed, while the same text is a fast skim on screen. So on a
 * voice turn the assistant is asked to open with the finding and put the
 * detail after a blank line — and only that opening is spoken.
 *
 * These tests pin the two halves of that: the instruction says the right
 * things, and the system prompt is BYTE-IDENTICAL whether a turn is typed or
 * spoken. The system block is the cached prefix of every turn; which turn is
 * spoken is carried by a marker on that user message (turnRegister.js).
 */
import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn(async () => []) }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({
  buildUnifiedSystemPrompt: vi.fn(async () => 'BASE_PROMPT'),
}));
vi.mock('./workspaceContext.js', () => ({
  loadWorkspaceContextSection: vi.fn(async () => ''),
}));

import { getChatConfig } from './chatConfigs.js';
import { buildVoiceRegisterSection } from './system-prompts/voiceRegister.js';
import { buildTextRegisterSection } from './system-prompts/textRegister.js';
import { VOICE_TURN_MARKER } from './turnRegister.js';
import { PAGE_CONTEXT_FIELDS, pickPageContext } from './pageContext.js';

const buildPrompt = (ctx) => getChatConfig('orchestrator').buildSystemPrompt(ctx);

describe('buildVoiceRegisterSection — presenter, not screen reader', () => {
  const text = () => buildVoiceRegisterSection();

  it('states that only the opening paragraph is spoken', () => {
    expect(text()).toMatch(/ONLY THE OPENING PARAGRAPH IS READ ALOUD/i);
    expect(text()).toMatch(/blank line/i);
  });

  it('asks for the answer first, not the approach', () => {
    expect(text()).toMatch(/Leads with the ANSWER, never the approach/i);
  });

  it('refuses to pad a genuinely short answer', () => {
    expect(text()).toMatch(/as short as the answer truly is/i);
    expect(text()).toMatch(/Do not pad it/i);
  });

  it('keeps code, paths, tables and URLs off the voice channel', () => {
    expect(text()).toMatch(/Never speaks code, file paths, tables, URLs/i);
    expect(text()).toMatch(/the diff is on screen/i);
  });

  it('says to point at detail rather than recite it, because reading is faster', () => {
    expect(text()).toMatch(/read far faster than you can speak/i);
  });

  it('THE INVARIANT: registers may differ in length, never in claim', () => {
    expect(text()).toMatch(/may differ in LENGTH\. They must never differ in CLAIM/i);
  });

  it('is plain speech — no markdown in the spoken part', () => {
    expect(text()).toMatch(/No markdown, no bullets, no headings/i);
  });

  it('applies to the marked user message only, and says typed messages are normal', () => {
    expect(text()).toContain(`A user message that begins with ${VOICE_TURN_MARKER}`);
    expect(text()).toMatch(/Messages without it are typed: answer\s+those normally/);
  });
});

describe('the system prompt is byte-identical whatever the input mode', () => {
  // The first prompt build lazy-imports the skill services and models and opens
  // the test database: ~0.6s alone, past the 5s test default under full-suite
  // load. Paid once here, with its own budget, so no test is timed on it.
  beforeAll(() => buildPrompt({ latestUserMessage: 'warm-up' }), 60000);

  const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
  const MODES = [
    ['typed', {}],
    ['voice', { voiceMode: true }],
    ['voice (multipart string)', { voiceMode: 'true' }],
    ['voice off', { voiceMode: false }],
    ['text message', { textMode: true }],
    ['voice over text message', { voiceMode: true, textMode: true }],
  ];

  it('every input mode produces the exact same bytes', async () => {
    const prompts = [];
    for (const [, flags] of MODES) prompts.push(await buildPrompt({ latestUserMessage: 'hello', ...flags }));
    const hashes = new Set(prompts.map(sha));
    expect(hashes.size).toBe(1);
    for (const prompt of prompts) expect(prompt).toBe(prompts[0]);
  });

  it('the voice and text guidance are always present, after the base prompt', async () => {
    const prompt = await buildPrompt({ latestUserMessage: 'hello' });
    expect(prompt).toBe(`BASE_PROMPT\n\n${buildVoiceRegisterSection()}\n\n${buildTextRegisterSection()}`);
  });

  it('the context panel accounts the guidance as one frozen section in every mode', async () => {
    for (const [, flags] of MODES) {
      const ctx = { latestUserMessage: 'hello', ...flags };
      await buildPrompt(ctx);
      const sections = ctx._promptSections || [];
      expect(sections.map((s) => s.id)).not.toContain('voice');
      expect(sections.map((s) => s.id)).not.toContain('text');
      const registers = sections.find((s) => s.id === 'turn-registers');
      expect(registers?.frozen).toBe(true);
      expect(registers.tokens).toBeGreaterThan(0);
    }
  });
});

describe('voiceMode rides the shared page-context list', () => {
  it('is carried from the request body like every other per-turn field', () => {
    // Hand-copying this field onto the context in OrchestratorService is how
    // workspaceState was lost once already; there is one list, and this is it.
    expect(PAGE_CONTEXT_FIELDS).toContain('voiceMode');
    expect(pickPageContext({ voiceMode: true })).toEqual({ voiceMode: true });
  });

  it('is omitted, not blanked, when the turn is typed', () => {
    expect('voiceMode' in pickPageContext({ message: 'hi' })).toBe(false);
  });

  it('survives the multipart string form ("true"), which is what FormData sends', () => {
    expect(pickPageContext({ voiceMode: 'true' }).voiceMode).toBe('true');
  });
});
