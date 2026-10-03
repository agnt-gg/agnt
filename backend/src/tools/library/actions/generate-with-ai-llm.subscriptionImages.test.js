// OpenAI images through the workflow/chat image node: the ChatGPT/Codex
// subscription first, the API second. The subscription transport and the
// OpenAI SDK are mocked, so nothing here reaches a real account.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const codexCalls = [];
const sdkCalls = [];
const ledger = [];
let codexBehaviour = async () => ({ generatedImages: [PNG], imageMetadata: { provider: 'openai-codex', returnedModel: null, usage: { input_tokens: 18, output_tokens: 515 } } });
let signedIn = true;

vi.mock('../../../services/ai/codexImageTransport.js', () => ({
  generateCodexImage: vi.fn(async (params, options) => { codexCalls.push({ params, options }); return codexBehaviour(params, options); }),
}));
vi.mock('../../../services/images/subscriptionFirstImage.js', async (importOriginal) => ({
  ...(await importOriginal()),
  chatGptSubscriptionSignedIn: vi.fn(async () => signedIn),
}));
vi.mock('../../../services/execution/LedgerRecorder.js', () => ({ recordLlmCall: vi.fn(async (row) => { ledger.push(row); }) }));
vi.mock('openai/index.mjs', () => {
  class FakeOpenAI {
    constructor(opts) {
      this.images = { generate: async (req) => { sdkCalls.push({ ...req, apiKey: opts?.apiKey }); return { data: [{ b64_json: 'QVBJ' }] }; } };
    }
  }
  return { default: FakeOpenAI, OpenAI: FakeOpenAI };
});

// The module exports a shared instance; each test gets a fresh one.
const { default: sharedNode } = await import('./generate-with-ai-llm.js');
const GenerateWithAiLlm = sharedNode.constructor;

let node;
let credentialLookups;
beforeEach(() => {
  codexCalls.length = 0; sdkCalls.length = 0; ledger.length = 0;
  signedIn = true;
  codexBehaviour = async () => ({ generatedImages: [PNG], imageMetadata: { provider: 'openai-codex', returnedModel: null, usage: { input_tokens: 18, output_tokens: 515 } } });
  node = new GenerateWithAiLlm();
  credentialLookups = [];
  node.resolveCredential = vi.fn(async (provider) => { credentialLookups.push(provider); return 'sk-test'; });
});
const run = (over = {}) => node.execute({ mode: 'Image Generation', provider: 'openai', model: 'gpt-image-1', imagePrompt: 'a red circle', imageOperation: 'Generate', numberOfImages: 1, imageSize: '1024x1024', ...over }, {}, { userId: 'user-1' });

describe('OpenAI images in the image node', () => {
  it('signed in: served by the subscription, no API key looked up, recorded as openai-codex', async () => {
    const out = await run();
    expect(out.error).toBe(null);
    expect(codexCalls).toHaveLength(1);
    expect(codexCalls[0].params).toMatchObject({ provider: 'openai-codex', imagePrompt: 'a red circle', imageSize: '1024x1024' });
    expect(codexCalls[0].options.userId).toBe('user-1');
    expect(sdkCalls).toHaveLength(0);
    expect(credentialLookups).toEqual([]);
    expect(out.generatedImages).toEqual([PNG]);
    expect(out.imageMetadata).toMatchObject({ servedBy: 'subscription', provider: 'openai-codex' });
    expect(ledger[0]).toMatchObject({ provider: 'openai-codex', model: 'chatgpt-subscription', usage: { inputTokens: 18, outputTokens: 515 } });
  });

  it('subscription fails: falls back to the OpenAI API with the API key, and says why', async () => {
    codexBehaviour = async () => { throw new Error('Codex image account not entitled (not retried).'); };
    const out = await run();
    expect(out.error).toBe(null);
    expect(credentialLookups).toEqual(['openai']);
    expect(sdkCalls).toHaveLength(1);
    expect(sdkCalls[0]).toMatchObject({ model: 'gpt-image-1', apiKey: 'sk-test', prompt: 'a red circle' });
    expect(out.generatedImages).toEqual(['data:image/png;base64,QVBJ']);
    expect(out.imageMetadata).toMatchObject({ servedBy: 'api', provider: 'openai', subscriptionSkipped: expect.stringMatching(/not entitled/) });
    expect(ledger[0]).toMatchObject({ provider: 'openai', model: 'gpt-image-1' });
  });

  it('not signed in: straight to the API, the subscription is never called', async () => {
    signedIn = false;
    const out = await run();
    expect(codexCalls).toHaveLength(0);
    expect(sdkCalls).toHaveLength(1);
    expect(out.imageMetadata).toMatchObject({ servedBy: 'api', subscriptionSkipped: expect.stringMatching(/not signed in/i) });
  });

  it('provider openai-codex is accepted and behaves the same (subscription first)', async () => {
    const out = await run({ provider: 'openai-codex' });
    expect(out.error).toBe(null);
    expect(codexCalls).toHaveLength(1);
  });

  it('two images: the subscription is skipped (one per request) and the API serves both', async () => {
    await run({ numberOfImages: 2 });
    expect(codexCalls).toHaveLength(0);
    expect(sdkCalls[0]).toMatchObject({ n: 2 });
  });

  it('no subscription and no API key: one clear error naming both', async () => {
    signedIn = false;
    node.resolveCredential = vi.fn(async () => { throw new Error('Authentication required for openai. Please set up API key or authenticate.'); });
    const out = await run();
    expect(out.error).toMatch(/Authentication required for openai.*ChatGPT subscription: not signed in/);
  });

  it('no API key stored (lookup returns nothing): says so instead of sending a null key', async () => {
    signedIn = false;
    node.resolveCredential = vi.fn(async () => null);
    const out = await run();
    expect(sdkCalls).toHaveLength(0);
    expect(out.error).toMatch(/No openai API key is connected.*ChatGPT subscription: not signed in/);
  });

  it('Gemini and Grok are untouched: no subscription attempt', async () => {
    node.generateImageWithGemini = vi.fn(async () => ({ generatedImages: [PNG] }));
    await run({ provider: 'gemini', model: undefined });
    expect(codexCalls).toHaveLength(0);
    expect(node.generateImageWithGemini).toHaveBeenCalledOnce();
    expect(credentialLookups).toEqual(['gemini']);
  });
});
