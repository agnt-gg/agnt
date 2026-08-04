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
 * things, and it reaches the prompt ONLY on a voice turn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn(async () => []) }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({
  buildUnifiedSystemPrompt: vi.fn(async () => 'BASE_PROMPT'),
}));
vi.mock('./workspaceContext.js', () => ({
  loadWorkspaceContextSection: vi.fn(async () => ''),
}));

import { getChatConfig } from './chatConfigs.js';
import { buildVoiceRegisterSection } from './system-prompts/voiceRegister.js';
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
});

describe('the voice section reaches the prompt only on a voice turn', () => {
  it('a normal turn gets the base prompt, untouched', async () => {
    const prompt = await buildPrompt({ latestUserMessage: 'hello' });
    expect(prompt).toBe('BASE_PROMPT');
  });

  it('a voice turn gets the section appended', async () => {
    const prompt = await buildPrompt({ latestUserMessage: 'hello', voiceMode: true });
    expect(prompt).toContain('BASE_PROMPT');
    expect(prompt).toContain('ONLY THE OPENING PARAGRAPH IS READ ALOUD');
  });

  it('appends at the TAIL, so the cached prefix is byte-identical', async () => {
    // The section is the only per-turn-varying part of the prompt. Putting it
    // anywhere but the end would move every byte after it between a spoken
    // turn and a typed one.
    const prompt = await buildPrompt({ latestUserMessage: 'hello', voiceMode: true });
    expect(prompt.startsWith('BASE_PROMPT')).toBe(true);
    expect(prompt.trimEnd().endsWith(buildVoiceRegisterSection().trimEnd())).toBe(true);
  });

  it('accounts for its own tokens, so the context panel does not under-report', async () => {
    const ctx = { latestUserMessage: 'hello', voiceMode: true };
    await buildPrompt(ctx);
    const voice = (ctx._promptSections || []).find((s) => s.id === 'voice');
    expect(voice).toBeTruthy();
    expect(voice.tokens).toBeGreaterThan(0);
  });

  it('adds no voice section to the accounting on a normal turn', async () => {
    const ctx = { latestUserMessage: 'hello' };
    await buildPrompt(ctx);
    expect((ctx._promptSections || []).some((s) => s.id === 'voice')).toBe(false);
  });

  it('a falsy voiceMode is not a voice turn', async () => {
    for (const value of [false, undefined, null, '']) {
      expect(await buildPrompt({ latestUserMessage: 'hi', voiceMode: value })).toBe('BASE_PROMPT');
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
