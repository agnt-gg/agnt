import { describe, it, expect } from 'vitest';
import { createLlmAdapter } from './llmAdapters.js';

/**
 * Cache affinity — the hints a request carries so it lands on a node that
 * already holds its prefix.
 *
 * Measured on grokai before the xAI hints were sent (2026-08-09, byte-identical
 * 39,998-token prefix, real orchestrator):
 *   cold conversation : turn 2 reused 128 tokens (0.3%)  -> $0.0499
 *   warm conversation : turn 2 reused 39,936    (99.8%)  -> $0.0081
 * A 6.2x cost swing decided by which node the request happened to reach. xAI
 * documents x-grok-conv-id as the fix.
 *
 * The negative controls here matter as much as the positive cases: an affinity
 * hint sent to a provider that does not understand it is not harmless, it is a
 * 400.
 */

const conversationId = 'conv-abc-123';
const expectedId = 'agnt-conv-abc-123';

async function adapterFor(provider, model, opts = {}) {
  return createLlmAdapter(provider, {}, model, { conversationId, ...opts });
}

describe('_cacheAffinity', () => {
  it('grokai sends the documented xAI header AND the body key', async () => {
    const a = await adapterFor('grokai', 'grok-4-0709');
    expect(a._cacheAffinity()).toEqual({
      body: { prompt_cache_key: expectedId },
      headers: { 'x-grok-conv-id': expectedId },
    });
  });

  it('openai-codex sends the CLI session_id header the ChatGPT backend keys on', async () => {
    // Measured on gpt-5.6-sol, 12 turns per arm, 18k byte-identical prefix,
    // candidate arm run FIRST so warming penalised it:
    //   baseline                       7/11
    //   session_id + prompt_cache_key 11/11
    //   session_id alone              11/11   <- the header is the mechanism
    // Every documented control (prompt_cache_breakpoint, prompt_cache_options,
    // store:true) returns 400 on this backend; the private header is the only
    // lever there is.
    const a = await adapterFor('openai-codex', 'gpt-5.6-sol');
    expect(a._cacheAffinity()).toEqual({
      body: { prompt_cache_key: expectedId },
      headers: { session_id: expectedId },
    });
  });

  it('openrouter keeps its documented sticky-routing key, body only', async () => {
    const a = await adapterFor('openrouter', 'anthropic/claude-haiku-4.5');
    expect(a._cacheAffinity()).toEqual({
      body: { session_id: expectedId },
      headers: null,
    });
  });

  it('NEGATIVE CONTROL: providers with no documented hint send nothing', async () => {
    // An unrecognised affinity field is a 400, not a no-op. This list is the
    // whole reason the mechanism is one method instead of scattered ifs.
    for (const [p, m] of [
      ['openai', 'gpt-4.1-mini'],        // already 99.7% via prompt_cache_options
      ['groq', 'openai/gpt-oss-20b'],    // no affinity parameter exists
      ['togetherai', 'openai/gpt-oss-20b'],
      ['deepseek', 'deepseek-chat'],
      ['kimi', 'kimi-k2-turbo-preview'],
      ['zai', 'glm-4.5-air'],
      ['minimax', 'MiniMax-M2.1-highspeed'],
      ['cerebras', 'gpt-oss-120b'],
      ['chutes', 'zai-org/GLM-5-FP8'],
    ]) {
      const a = await adapterFor(p, m);
      expect(a._cacheAffinity(), `${p} must not send an affinity hint`).toBeNull();
    }
  });

  it('NEGATIVE CONTROL: no conversation id means no hint for anyone', async () => {
    for (const [p, m] of [['grokai', 'grok-4-0709'], ['openrouter', 'anthropic/claude-haiku-4.5']]) {
      const a = await createLlmAdapter(p, {}, m, {});
      expect(a._cacheAffinity(), `${p} with no conversation`).toBeNull();
    }
  });

  it('_cacheRoutingParams stays body-only for existing callers', async () => {
    const grok = await adapterFor('grokai', 'grok-4-0709');
    const router = await adapterFor('openrouter', 'anthropic/claude-haiku-4.5');
    expect(grok._cacheRoutingParams()).toEqual({ prompt_cache_key: expectedId });
    expect(router._cacheRoutingParams()).toEqual({ session_id: expectedId });
  });

  it('the Responses hierarchy carries the identity the hint needs', async () => {
    // This hierarchy descends from BaseAdapter, not OpenAiLikeAdapter, and
    // used to store neither provider nor conversationId — which is precisely
    // why the Codex hint had nowhere to attach. A regression here would make
    // _cacheAffinity silently return null rather than fail.
    const codex = await adapterFor('openai-codex', 'gpt-5.6-sol');
    expect(codex.provider).toBe('openai-codex');
    expect(codex.conversationId).toBe(conversationId);
  });

  it('caps the identifier at the 256-char API contract', async () => {
    const long = 'x'.repeat(400);
    const a = await createLlmAdapter('grokai', {}, 'grok-4-0709', { conversationId: long });
    const aff = a._cacheAffinity();
    expect(aff.body.prompt_cache_key.length).toBe(256);
    expect(aff.headers['x-grok-conv-id'].length).toBe(256);
  });

  it('is stable across calls — an affinity key that changes is no affinity key', async () => {
    const a = await adapterFor('grokai', 'grok-4-0709');
    expect(a._cacheAffinity()).toEqual(a._cacheAffinity());
  });
});
