/**
 * workflowEngine.ai: plugin tools use the account's selected AI, the way custom
 * AI tools do (reported 2026-10-21: a Blog Generator plugin could only call a
 * vendor API with a token, which Claude Code and Codex subscriptions never have).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let account = { provider: 'claude-code', model: 'claude-opus-5-5' };
vi.mock('./accountAi.js', () => ({ resolveAccountAi: vi.fn(async () => account) }));
const execute = vi.fn(async () => ({ generatedText: 'a draft' }));
vi.mock('../../tools/library/actions/generate-with-ai-llm.js', () => ({ default: { execute } }));

const { createPluginAi } = await import('./pluginAi.js');
const { resolveAccountAi } = await import('./accountAi.js');

beforeEach(() => vi.clearAllMocks());

describe('workflowEngine.ai.generate', () => {
  it('runs on the selected AI, a subscription included, and follows it when it changes', async () => {
    const engine = { userId: 'u1' };
    const ai = createPluginAi(() => engine.userId, engine);
    expect(await ai.generate({ prompt: 'Write a post', system: 'You are a writer', maxTokens: 900 })).toEqual({ text: 'a draft', provider: 'claude-code', model: 'claude-opus-5-5' });
    expect(resolveAccountAi).toHaveBeenCalledWith('u1');
    expect(execute.mock.calls[0][0]).toMatchObject({ prompt: 'You are a writer\n\nWrite a post', provider: 'claude-code', model: 'claude-opus-5-5', maxTokens: 900 });
    expect(execute.mock.calls[0][2]).toBe(engine);

    account = { provider: 'openai-codex', model: 'gpt-6-astra' };
    expect((await ai.generate({ prompt: 'x' })).provider).toBe('openai-codex');
  });

  it("throws the model's error instead of returning an empty draft", async () => {
    execute.mockResolvedValueOnce({ generatedText: '', error: 'rate limited' });
    await expect(createPluginAi(() => 'u1', {}).generate({ prompt: 'x' })).rejects.toThrow('rate limited');
  });

  it('refuses an empty prompt and a missing user before spending anything', async () => {
    await expect(createPluginAi(() => 'u1', {}).generate({ prompt: '  ' })).rejects.toThrow(/needs a prompt/);
    await expect(createPluginAi(() => null, {}).generate({ prompt: 'x' })).rejects.toThrow(/no signed-in user/);
    expect(execute).not.toHaveBeenCalled();
  });
});
