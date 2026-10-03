// OpenAI images go to the ChatGPT/Codex subscription first, and to the API
// only when the subscription cannot serve the request or fails.
import { describe, it, expect, vi } from 'vitest';
import { generateImageSubscriptionFirst, subscriptionIneligibility, isSubscriptionFirstProvider } from './subscriptionFirstImage.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const subResult = { generatedImages: [PNG], imageMetadata: { provider: 'openai-codex', returnedModel: null, usage: { input_tokens: 18, output_tokens: 515 } } };
const apiResult = { generatedImages: [PNG], imageMetadata: { model: 'gpt-image-1' } };
const deps = (over = {}) => ({
  subscription: { signedIn: vi.fn(() => true), generate: vi.fn(async () => subResult), ...over.subscription },
  api: vi.fn(async () => apiResult),
  ...over,
  ...(over.api ? { api: over.api } : {}),
});
const params = { provider: 'openai', imagePrompt: 'a red circle', imageOperation: 'Generate', numberOfImages: 1, userId: 'u1' };

describe('which providers go subscription-first', () => {
  it.each([['openai', true], ['OpenAI', true], ['openai-codex', true], ['gemini', false], ['grokai', false]])('%s → %s', (p, want) => {
    expect(isSubscriptionFirstProvider(p)).toBe(want);
  });
});

describe('subscription first', () => {
  it('signed in: the subscription serves it and the API is never called', async () => {
    const d = deps();
    const out = await generateImageSubscriptionFirst(params, d);
    expect(d.subscription.generate).toHaveBeenCalledOnce();
    expect(d.api).not.toHaveBeenCalled();
    expect(out.servedBy).toBe('subscription');
    expect(out.servedProvider).toBe('openai-codex');
    expect(out.generatedImages).toEqual([PNG]);
  });

  it('subscription fails: falls back to the API and says why', async () => {
    const d = deps({ subscription: { signedIn: () => true, generate: vi.fn(async () => { throw new Error('Codex image account not entitled (not retried).'); }) } });
    const out = await generateImageSubscriptionFirst(params, d);
    expect(d.api).toHaveBeenCalledOnce();
    expect(out.servedBy).toBe('api');
    expect(out.servedProvider).toBe('openai');
    expect(out.subscriptionSkipped).toMatch(/not entitled/);
  });

  it('not signed in: straight to the API, subscription untouched', async () => {
    const d = deps({ subscription: { signedIn: () => false, generate: vi.fn() } });
    const out = await generateImageSubscriptionFirst(params, d);
    expect(d.subscription.generate).not.toHaveBeenCalled();
    expect(out.servedBy).toBe('api');
    expect(out.subscriptionSkipped).toMatch(/not signed in/i);
  });

  it('a signed-in check that throws counts as not signed in', async () => {
    const d = deps({ subscription: { signedIn: () => { throw new Error('bad credential file'); }, generate: vi.fn() } });
    const out = await generateImageSubscriptionFirst(params, d);
    expect(d.subscription.generate).not.toHaveBeenCalled();
    expect(out.servedBy).toBe('api');
  });

  it('both fail: the error names both causes', async () => {
    const d = deps({
      subscription: { signedIn: () => true, generate: async () => { throw new Error('Codex image rate limited (not retried).'); } },
      api: vi.fn(async () => { throw new Error('Authentication required for openai.'); }),
    });
    await expect(generateImageSubscriptionFirst(params, d)).rejects.toThrow(/Authentication required for openai.*ChatGPT subscription: Codex image rate limited/);
  });

  it('fallback goes to the named API provider (e.g. the account image provider)', async () => {
    const d = deps({ subscription: { signedIn: () => false, generate: vi.fn() } });
    const out = await generateImageSubscriptionFirst({ ...params, fallbackProvider: 'gemini' }, d);
    expect(d.api).toHaveBeenCalledWith(expect.objectContaining({ fallbackProvider: 'gemini' }), 'gemini');
    expect(out.servedProvider).toBe('gemini');
  });
});

describe('requests the subscription cannot serve go to the API without trying it', () => {
  it.each([
    [{ numberOfImages: 2 }, /one image per request/],
    [{ imageOperation: 'Variation' }, /variation/i],
    [{ imageOperation: 'Edit', referenceImage: 'data:image/jpeg;base64,/9j/' }, /PNG reference/],
    [{ imageOperation: 'Edit' }, /PNG reference/],
  ])('%j', async (over, reason) => {
    expect(subscriptionIneligibility({ ...params, ...over })).toMatch(reason);
    const d = deps();
    const out = await generateImageSubscriptionFirst({ ...params, ...over }, d);
    expect(d.subscription.generate).not.toHaveBeenCalled();
    expect(out.subscriptionSkipped).toMatch(reason);
  });

  it('an edit with a PNG reference is eligible', () => {
    expect(subscriptionIneligibility({ ...params, imageOperation: 'Edit', referenceImage: PNG })).toBe(null);
  });
});
