/**
 * Reported 2026-10-21: a Blog Post Generator AI tool, test-run from the tool
 * editor, ignored its prompt and returned outputs it does not declare. Three
 * causes, each pinned here, through runCustomTool (the path Test, agents and
 * chat all use):
 *   1. the runner built parameters from the call's arguments only, dropping
 *      the tool's prompt, provider, model and input defaults;
 *   2. {{input}} in the prompt went to the step resolver and became "undefined";
 *   3. the answer was the raw model result, without the declared success/result.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai/accountAi.js', () => ({ resolveAccountAi: vi.fn(async () => ({ provider: 'agnt', model: 'agnt-flash' })) }));
const generate = vi.fn(async () => ({ generatedText: '# Bananas', tokenCount: 12, inputTokens: 5, outputTokens: 7 }));
vi.mock('../../tools/library/actions/generate-with-ai-llm.js', () => ({ default: { execute: generate } }));

const { runCustomTool, mergedParameters } = await import('./customToolRunner.js');
const { fillInputPlaceholders, aiToolOutputs } = await import('../../workflow/CustomToolExecutor.js');

const blogTool = {
  id: 't1',
  base: 'AI',
  type: 'blog-post-generator',
  parameters: JSON.stringify({
    topic: { type: 'text', label: 'Topic', required: true },
    audience: { type: 'text', label: 'Audience', value: 'beginners' },
    instructions: 'Write a blog post about {{topic}} for {{Audience}}. Keep {{unknownStep.field}} as is.',
    provider: 'groq',
    model: 'llama-4',
  }),
};
const sent = () => generate.mock.calls.at(-1)[0];

beforeEach(() => generate.mockClear());

describe('a stored AI tool, run outside a workflow', () => {
  it('runs WITH its prompt, its provider and model, and its input defaults', async () => {
    await runCustomTool(blogTool, { topic: 'Bananas' }, 'u1');
    expect(sent().prompt.startsWith('Write a blog post about Bananas for beginners.')).toBe(true);
    expect(sent()).toMatchObject({ provider: 'groq', model: 'llama-4' });
    expect(sent().prompt).toContain('topic: Bananas');
  });

  it('returns exactly what the tool declares: success, result, error (+ generatedText, tokenCount)', async () => {
    const out = await runCustomTool(blogTool, { topic: 'Bananas' }, 'u1');
    expect(out).toEqual({ success: true, result: '# Bananas', error: null, generatedText: '# Bananas', tokenCount: 12 });
  });

  it('a model failure is success false with the model error', async () => {
    generate.mockResolvedValueOnce({ generatedText: '', error: 'rate limited' });
    expect(await runCustomTool(blogTool, { topic: 'x' }, 'u1')).toMatchObject({ success: false, result: null, error: 'rate limited' });
  });
});

describe('pieces', () => {
  it('mergedParameters: argument, else default, else empty; extra arguments kept', () => {
    expect(mergedParameters({ a: { type: 'text' }, b: { value: 'd' }, instructions: 'P' }, { a: 'x', z: 1 })).toEqual({ a: 'x', b: 'd', instructions: 'P', z: 1 });
    expect(mergedParameters('{bad json', { a: 1 })).toEqual({ a: 1 });
  });

  it('fillInputPlaceholders: inputs only, any case; steps and settings are left alone', () => {
    expect(fillInputPlaceholders('{{ Topic }} / {{model}} / {{step.field}} / {{none}}', { topic: 'T', model: 'm' })).toBe('T / {{model}} / {{step.field}} / {{none}}');
    expect(fillInputPlaceholders('{{data}}', { data: { a: 1 } })).toBe('{"a":1}');
  });

  it('aiToolOutputs maps the model result to the declared shape', () => {
    expect(aiToolOutputs({ generatedText: 'hi', tokenCount: 3, cacheReadTokens: 9 })).toEqual({ success: true, result: 'hi', error: null, generatedText: 'hi', tokenCount: 3 });
  });
});
