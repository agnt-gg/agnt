/**
 * An AGNT Flash refusal reaches chat as the gateway's sentence, framed as a
 * notice, not as "⚠️ API Error: 402 … check your API configuration".
 *
 * Driven through the real OpenAiLikeAdapter with the real OpenAI SDK error
 * class, built from the exact body models.agnt.gg sends, so the test covers
 * the SDK's "402 " prefix and both the streaming and non-streaming paths.
 */
import { describe, it, expect } from 'vitest';
import { APIError } from 'openai';
import { OpenAiLikeAdapter } from './chatCompletions.js';
import { agntServiceNotice, AGNT_NOTICE_CODES } from './agntServiceNotice.js';

const TRIAL_SENTENCE =
  'Your free AGNT Flash trial credits are used up. Upgrade for 100M credits a month at https://agnt.gg/pricing, or keep going with your own API key or subscription (Claude Code, ChatGPT, OpenAI and more) from the model menu.';

function gatewayError(status, code, message) {
  return APIError.generate(status, { error: { message, type: 'insufficient_quota', code } }, undefined, new Headers());
}

function adapterThrowing(error, provider = 'agnt') {
  const client = { chat: { completions: { create: async () => { throw error; } } } };
  const adapter = new OpenAiLikeAdapter(client, 'agnt-flash', { provider });
  adapter.maxRetries = 0; // one attempt: these tests are about framing, not backoff
  return adapter;
}

const history = [{ role: 'user', content: 'hi' }];

describe('AGNT Flash refusals in chat', () => {
  it('a spent trial reads as a notice with a clickable upgrade link (non-streaming)', async () => {
    const result = await adapterThrowing(gatewayError(402, 'trial_credit_exhausted', TRIAL_SENTENCE)).call(history, []);
    const content = result.responseMessage.content;
    expect(content.startsWith('Your free AGNT Flash trial credits are used up.')).toBe(true);
    expect(content).toContain('[agnt.gg/pricing](https://agnt.gg/pricing),');
    expect(content).not.toMatch(/API Error|^402|check your API configuration/);
    expect(result.recoveredFromError).toBe(true); // the turn still ends, as before
  });

  it('frames the streaming path the same way', async () => {
    const result = await adapterThrowing(gatewayError(402, 'trial_credit_exhausted', TRIAL_SENTENCE)).callStream(history, [], () => {}, {});
    expect(result.responseMessage.content.startsWith('Your free AGNT Flash trial credits are used up.')).toBe(true);
    expect(result.responseMessage.content).not.toContain('API Error');
  });

  it('treats every credit and spending state as a notice', () => {
    for (const code of AGNT_NOTICE_CODES) {
      const notice = agntServiceNotice(gatewayError(402, code, `State ${code}.`), 'agnt');
      expect(notice).toBe(`State ${code}.`);
    }
    expect([...AGNT_NOTICE_CODES].sort()).toEqual(['budget_exceeded', 'insufficient_credit', 'spending_not_authorized', 'trial_credit_exhausted']);
  });

  it('labels other gateway failures as AGNT Flash, without the status or key advice', () => {
    const notice = agntServiceNotice(gatewayError(429, 'rate_limited', 'Too many requests. Wait a moment and try again.'), 'agnt');
    expect(notice).toBe('⚠️ **AGNT Flash:** Too many requests. Wait a moment and try again.');
  });

  it('falls back to the SDK message minus its status prefix when the body has no sentence', () => {
    const bare = APIError.generate(503, { error: 'service_unavailable' }, undefined, new Headers());
    expect(agntServiceNotice(bare, 'agnt')).toBe('⚠️ **AGNT Flash:** "service_unavailable"');
    expect(agntServiceNotice({ message: '' }, 'agnt')).toBeNull();
  });

  it('leaves every other provider on the existing generic message', async () => {
    const error = gatewayError(402, 'insufficient_quota', 'You exceeded your current quota.');
    expect(agntServiceNotice(error, 'openai')).toBeNull();
    const result = await adapterThrowing(error, 'openai').call(history, []);
    expect(result.responseMessage.content).toBe(
      '⚠️ **API Error:** 402 You exceeded your current quota.\n\nPlease check your API configuration or try a different provider.',
    );
  });
});
