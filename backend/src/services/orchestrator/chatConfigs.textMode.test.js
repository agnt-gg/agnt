/**
 * A text-message turn (mobile.agnt.gg) is answered on a phone, so its reply
 * must be short plain text. These tests pin that the instruction exists, rides
 * the shared page-context list, and reaches the prompt ONLY on a text turn, at
 * the tail, leaving the cached prefix untouched.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn(async () => []) }));
vi.mock('./system-prompts/buildUnifiedPrompt.js', () => ({
  buildUnifiedSystemPrompt: vi.fn(async () => 'BASE_PROMPT'),
}));
vi.mock('./workspaceContext.js', () => ({
  loadWorkspaceContextSection: vi.fn(async () => ''),
}));

import { getChatConfig } from './chatConfigs.js';
import { buildTextRegisterSection } from './system-prompts/textRegister.js';
import { PAGE_CONTEXT_FIELDS, pickPageContext } from './pageContext.js';

const buildPrompt = (ctx) => getChatConfig('orchestrator').buildSystemPrompt(ctx);

describe('buildTextRegisterSection', () => {
  it('asks for a short plain-text answer, lead first', () => {
    const text = buildTextRegisterSection();
    expect(text).toMatch(/TEXT MESSAGE MODE/);
    expect(text).toMatch(/Lead with the answer/);
    expect(text).toMatch(/No tables, headings, code blocks/);
  });

  it('keeps the work unchanged and file paths off the phone', () => {
    const text = buildTextRegisterSection();
    expect(text).toMatch(/Do the work exactly as you normally/);
    expect(text).toMatch(/Never reference local file paths/);
  });
});

describe('textMode rides the shared page-context list', () => {
  it('is carried from the request body like every other per-turn field', () => {
    expect(PAGE_CONTEXT_FIELDS).toContain('textMode');
    expect(pickPageContext({ textMode: true })).toEqual({ textMode: true });
    expect('textMode' in pickPageContext({ message: 'hi' })).toBe(false);
  });
});

describe('the text section reaches the prompt only on a text turn', () => {
  beforeAll(() => buildPrompt({ latestUserMessage: 'warm-up' }), 60000);

  it('a normal turn is untouched', async () => {
    expect(await buildPrompt({ latestUserMessage: 'hello' })).toBe('BASE_PROMPT');
  });

  it('a text turn appends the section after the unchanged prefix', async () => {
    const prompt = await buildPrompt({ latestUserMessage: 'hello', textMode: true });
    expect(prompt.startsWith('BASE_PROMPT')).toBe(true);
    expect(prompt).toContain(buildTextRegisterSection());
  });

  it('the multipart string "false" is not a text turn', async () => {
    expect(await buildPrompt({ latestUserMessage: 'hi', textMode: 'false' })).toBe('BASE_PROMPT');
  });
});
