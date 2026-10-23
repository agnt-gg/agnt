/**
 * An AI tool saved on "Default AI" (empty provider and model) runs on the
 * account's selected AI at call time, and follows it when it changes. The Tool
 * Forge relies on this since 2026-10-21; a pinned tool keeps its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let accountAi = { provider: 'anthropic', model: 'claude-3' };
vi.mock('../services/ai/accountAi.js', () => ({ resolveAccountAi: vi.fn(async () => accountAi) }));
vi.mock('../tools/library/actions/generate-with-ai-llm.js', () => ({ default: { execute: vi.fn(async () => ({ success: true })) } }));
vi.mock('../tools/library/utilities/execute-javascript.js', () => ({ default: { execute: vi.fn() } }));
vi.mock('../tools/library/utilities/execute-python.js', () => ({ default: { execute: vi.fn() } }));

const { default: CustomToolExecutor } = await import('./CustomToolExecutor.js');
const { default: Generate } = await import('../tools/library/actions/generate-with-ai-llm.js');
const { resolveAccountAi } = await import('../services/ai/accountAi.js');

const engine = { userId: 'u1', parameterResolver: { resolveTemplate: async (v) => v } };
const tool = (provider, model) => ({ base: 'AI', parameters: { instructions: 'Summarise', provider, model, text: 'hello' } });
const sentTo = () => Generate.execute.mock.calls.at(-1)[0];

beforeEach(() => vi.clearAllMocks());

describe('Default AI tools', () => {
  it('run on the account selection, and follow it when it changes', async () => {
    await new CustomToolExecutor(engine).execute(tool('', ''), {});
    expect(sentTo()).toMatchObject({ provider: 'anthropic', model: 'claude-3' });
    expect(resolveAccountAi).toHaveBeenCalledWith('u1', expect.anything());

    accountAi = { provider: 'openai', model: 'gpt-5' };
    await new CustomToolExecutor(engine).execute(tool('', ''), {});
    expect(sentTo()).toMatchObject({ provider: 'openai', model: 'gpt-5' });
  });

  it('a pinned tool keeps its own provider and model', async () => {
    await new CustomToolExecutor(engine).execute(tool('groq', 'llama-4'), {});
    expect(sentTo()).toMatchObject({ provider: 'groq', model: 'llama-4' });
    expect(resolveAccountAi).not.toHaveBeenCalled();
  });
});
