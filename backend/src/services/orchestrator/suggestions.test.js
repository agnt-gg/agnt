import { describe, it, expect, vi } from 'vitest';
import { parseSuggestions, fallbackSuggestions, withIds, buildSuggestionUserPrompt, generateSuggestions, FALLBACK_SUGGESTIONS } from './suggestions.js';

describe('parseSuggestions — strict, because null means "try the next model"', () => {
  it('accepts the documented shape', () => {
    expect(parseSuggestions('[{"text":"A","icon":"1"},{"text":"B","icon":"2"},{"text":"C","icon":"3"}]'))
      .toEqual([{ text: 'A', icon: '1' }, { text: 'B', icon: '2' }, { text: 'C', icon: '3' }]);
  });

  it('accepts fences, reasoning tags, prose around the array, and bare strings', () => {
    expect(parseSuggestions('<think>hmm</think>\n```json\n["A","B","C"]\n```')).toHaveLength(3);
    expect(parseSuggestions('Here you go: ["A","B","C"] hope that helps')).toHaveLength(3);
  });

  it('gives a missing icon the default rather than rejecting', () => {
    expect(parseSuggestions('[{"text":"A"},{"text":"B"},{"text":"C"}]')[0].icon).toBe('◊');
  });

  it.each([
    ['not json'],
    ['[]'],
    ['["A","B"]'],
    ['["A","B","C","D"]'],
    ['[{"text":""},{"text":"B"},{"text":"C"}]'],
    ['[{"icon":"x"},{"text":"B"},{"text":"C"}]'],
    [`["${'x'.repeat(121)}","B","C"]`],
  ])('rejects %j', (input) => {
    expect(parseSuggestions(input)).toBeNull();
  });
});

describe('the fallback and ids', () => {
  it('returns copies, so a caller cannot mutate the shared fallback', () => {
    const a = fallbackSuggestions();
    a[0].text = 'changed';
    expect(FALLBACK_SUGGESTIONS[0].text).toBe('Tell me more about this');
  });

  it('ids are unique per response', () => {
    const ids = withIds([{ text: 'a' }, { text: 'b' }, { text: 'c' }], 42).map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('the prompt carries both messages', () => {
    const prompt = buildSuggestionUserPrompt({ lastUserMessage: 'Q?', lastAssistantMessage: 'A.' });
    expect(prompt).toContain('"Q?"');
    expect(prompt).toContain('"A."');
  });
});

describe('generateSuggestions', () => {
  const good = '["A","B","C"]';

  it('routes as origin suggestion, the chat model as a last resort, the answer checked', async () => {
    const complete = vi.fn(async () => ({ text: good }));
    const out = await generateSuggestions(
      { userId: 'u', systemPrompt: 'sys', lastUserMessage: 'q', lastAssistantMessage: 'a', provider: 'anthropic', model: 'opus' },
      complete,
    );
    expect(out.suggestions.map((s) => s.text)).toEqual(['A', 'B', 'C']);
    const call = complete.mock.calls[0][0];
    expect(call).toMatchObject({ userId: 'u', origin: 'suggestion', alsoTry: [{ provider: 'anthropic', model: 'opus' }] });
    expect(call.validate(good)).toBe(true);
    expect(call.validate('nope')).not.toBe(true);
  });

  it('never carries the conversation id — a side call must not move cache affinity', async () => {
    const complete = vi.fn(async () => ({ text: good }));
    await generateSuggestions({ userId: 'u', systemPrompt: 's', conversationId: 'c1' }, complete);
    expect(complete.mock.calls[0][0].conversationId).toBeUndefined();
  });

  it('no chat model given: nothing appended', async () => {
    const complete = vi.fn(async () => ({ text: good }));
    await generateSuggestions({ userId: 'u', systemPrompt: 's' }, complete);
    expect(complete.mock.calls[0][0].alsoTry).toEqual([]);
  });

  it('any failure degrades to the generic three, with the reason', async () => {
    const complete = vi.fn(async () => { throw Object.assign(new Error('every model failed'), { code: 'ALL_TIERS_FAILED' }); });
    const out = await generateSuggestions({ userId: 'u', systemPrompt: 's' }, complete);
    expect(out.suggestions).toEqual(fallbackSuggestions());
    expect(out.error).toBe('every model failed');
  });
});
