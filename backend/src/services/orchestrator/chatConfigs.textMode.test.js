/**
 * A text-message turn (mobile.agnt.gg) is answered on a phone, so its reply
 * must be short plain text. These tests pin that the instruction exists, rides
 * the shared page-context list, and is in EVERY system prompt so a texted turn
 * and a typed one share one cached prefix. Which turn is texted is carried by
 * a marker on that user message (turnRegister.js).
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
import { TEXT_TURN_MARKER } from './turnRegister.js';
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
    expect(text).toMatch(/Never reference local file paths otherwise/);
  });

  it('tells Annie how files travel both ways', () => {
    const text = buildTextRegisterSection();
    expect(text).toMatch(/file:\/\/\/ link/);
    expect(text).toMatch(/attached to your reply automatically, up to 4 files/);
    expect(text).toMatch(/voice notes \(as a transcript\)/);
  });

  it('teaches the tapback marker, the six reactions, and reading the user\'s', () => {
    const text = buildTextRegisterSection();
    expect(text).toContain('open your reply with [react: 👍]');
    expect(text).toContain('❤️ 👍 👎 😂 ‼️ ❓');
    expect(text).toMatch(/Never react instead of answering a question/);
    expect(text).toContain('[Reacted 👍 to your message:');
  });

  it('applies to the marked user message only', () => {
    expect(buildTextRegisterSection()).toContain(`A user message that begins with ${TEXT_TURN_MARKER}`);
  });
});

describe('textMode rides the shared page-context list', () => {
  it('is carried from the request body like every other per-turn field', () => {
    expect(PAGE_CONTEXT_FIELDS).toContain('textMode');
    expect(pickPageContext({ textMode: true })).toEqual({ textMode: true });
    expect('textMode' in pickPageContext({ message: 'hi' })).toBe(false);
  });
});

describe('a text turn and a typed turn get the same system prompt', () => {
  beforeAll(() => buildPrompt({ latestUserMessage: 'warm-up' }), 60000);

  it('textMode true, "true", "false" and absent all build identical bytes', async () => {
    const typed = await buildPrompt({ latestUserMessage: 'hello' });
    expect(typed).toContain(buildTextRegisterSection());
    for (const textMode of [true, 'true', 'false', false]) {
      expect(await buildPrompt({ latestUserMessage: 'hello', textMode })).toBe(typed);
    }
  });
});
