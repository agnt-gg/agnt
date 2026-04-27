/**
 * Chutes.ai E2EE transport integration tests.
 *
 * Live tests require CHUTES_E2EE_LIVE=1 and a valid CHUTES_API_KEY.
 * Skips gracefully unless both are available.
 *
 * Run live:  CHUTES_E2EE_LIVE=1 CHUTES_API_KEY=cpk_xxx npx vitest run tests/unit/chutes.e2ee.test.js
 * Or:  npx vitest run tests/unit/chutes.e2ee.test.js    (skips live tests)
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  getAllModelMetadata,
  getProviderConfig,
  registerDynamicPricingFromModels,
} from '../../backend/src/services/ai/providerConfigs.js';

// ---------------------------------------------------------------------------
// Live transport tests — only run when CHUTES_API_KEY is present
// ---------------------------------------------------------------------------

const API_KEY = process.env.CHUTES_API_KEY;
const RUN_LIVE = process.env.CHUTES_E2EE_LIVE === '1' && Boolean(API_KEY);
const LIVE_TEST_TIMEOUT_MS = 60_000;

describe('Chutes Provider Config', () => {
  it('should exist in providerConfigs', () => {
    const cfg = getProviderConfig('chutes');
    assert.ok(cfg, 'chutes provider config not found');
    assert.strictEqual(cfg.name, 'Chutes');
    assert.strictEqual(cfg.baseURL, 'https://llm.chutes.ai/v1');
    assert.ok(cfg.e2ee, 'expected e2ee flag');
    assert.strictEqual(cfg.sdkType, 'openai');
    assert.notStrictEqual(cfg.staticModels, true);
    assert.ok(cfg.modelTransform, 'expected dynamic model transform');
    assert.ok(cfg.modelFilter, 'expected dynamic model filter');
    assert.ok(cfg.fallbackModels.length > 0, 'expected fallbackModels');
  });

  it('should expose TEE fallback models', () => {
    const cfg = getProviderConfig('chutes');
    assert.deepStrictEqual(cfg.fallbackModels, [
      'moonshotai/Kimi-K2.5-TEE',
      'moonshotai/Kimi-K2.6-TEE',
      'zai-org/GLM-5-TEE',
      'zai-org/GLM-5.1-TEE',
      'Qwen/Qwen3-32B-TEE',
      'Qwen/Qwen3.5-397B-A17B-TEE',
      'Qwen/Qwen3.6-27B-TEE',
      'MiniMaxAI/MiniMax-M2.5-TEE',
    ]);
    assert.ok(cfg.fallbackModels.every((model) => model.endsWith('-TEE')));
    for (const model of cfg.fallbackModels) {
      const metadata = cfg.modelMetadata[model];
      assert.ok(metadata, `Missing metadata for ${model}`);
      assert.ok(metadata.contextWindow > 0, `Missing context window for ${model}`);
      assert.ok(metadata.maxOutputTokens > 0, `Missing output limit for ${model}`);
      assert.strictEqual(metadata.confidentialCompute, true, `${model} should be confidential compute`);
      assert.ok(metadata.chuteId, `Missing chute id for ${model}`);
    }
    assert.strictEqual(cfg.modelMetadata['Qwen/Qwen3.6-27B-TEE'].supportsTools, true);
    assert.strictEqual(cfg.modelMetadata['Qwen/Qwen3.5-397B-A17B-TEE'].supportsTools, true);
  });

  it('should transform only confidential-compute models from /v1/models', () => {
    const cfg = getProviderConfig('chutes');
    const teeModel = {
      id: 'example/TEE-Model',
      root: 'example/base-model',
      created: 1777235537,
      chute_id: '11111111-1111-4111-8111-111111111111',
      owned_by: 'vllm',
      context_length: 131072,
      max_output_length: 65536,
      input_modalities: ['text', 'image'],
      supported_features: ['tools', 'reasoning'],
      confidential_compute: true,
      pricing: {
        prompt: 0.12,
        completion: 0.75,
        input_cache_read: 0.06,
      },
    };
    const nonTeeModel = {
      ...teeModel,
      id: 'example/Plain-Model',
      confidential_compute: false,
    };

    assert.strictEqual(cfg.modelFilter(teeModel), true);
    assert.strictEqual(cfg.modelFilter(nonTeeModel), false);

    const transformed = cfg.modelTransform(teeModel);
    assert.deepStrictEqual(transformed, {
      id: 'example/TEE-Model',
      name: 'example/TEE-Model',
      description: 'TEE model for example/base-model',
      createdAt: 1777235537,
      ownedBy: 'vllm',
      contextLength: 131072,
      maxOutputLength: 65536,
      inputCostPer1M: 0.12,
      outputCostPer1M: 0.75,
      inputCacheReadCostPer1M: 0.06,
      supportsVision: true,
      supportsTools: true,
      reasoning: true,
      chuteId: '11111111-1111-4111-8111-111111111111',
      root: 'example/base-model',
      confidentialCompute: true,
    });
  });

  it('should register dynamic metadata from fetched Chutes models', () => {
    registerDynamicPricingFromModels('chutes', [{
      id: 'example/TEE-Model',
      contextLength: 131072,
      maxOutputLength: 65536,
      inputCostPer1M: 0.12,
      outputCostPer1M: 0.75,
      inputCacheReadCostPer1M: 0.06,
      supportsVision: true,
      supportsTools: true,
      reasoning: true,
      chuteId: '11111111-1111-4111-8111-111111111111',
      root: 'example/base-model',
      ownedBy: 'vllm',
      confidentialCompute: true,
    }]);

    const metadata = getAllModelMetadata('chutes');
    assert.deepStrictEqual(metadata['example/TEE-Model'], {
      inputCostPer1M: 0.12,
      outputCostPer1M: 0.75,
      inputCacheReadCostPer1M: 0.06,
      contextWindow: 131072,
      maxOutputTokens: 65536,
      supportsVision: true,
      supportsTools: true,
      reasoning: true,
      chuteId: '11111111-1111-4111-8111-111111111111',
      root: 'example/base-model',
      ownedBy: 'vllm',
      confidentialCompute: true,
      dynamic: true,
    });
  });
});

describe('Chutes E2EE Offline Transport', () => {
  it('should encrypt and route chat completions through mocked E2EE invoke', async () => {
    const { default: ChutesE2EEFetchTransport } = await import('../../backend/src/services/ai/chutes/ChutesE2EEFetchTransport.js');
    const { generateKeyPair } = await import('../../backend/src/services/ai/chutes/ChutesE2EECrypto.js');

    const model = 'Qwen/Qwen3-32B-TEE';
    const chuteId = 'ac059e33-eb27-541c-b9a9-24b214036475';
    const instanceId = 'instance-offline-test';
    const e2eNonce = 'nonce-offline-test';
    const prompt = 'Secret offline prompt 42 xyz';
    const { pk: instancePublicKey } = await generateKeyPair();

    const originalFetch = globalThis.fetch;
    const calls = [];

    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      calls.push({ url: href, init });

      if (href === 'https://llm.chutes.ai/v1/models') {
        return new Response(JSON.stringify({
          data: [{ id: model, chute_id: chuteId }],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (href === `https://api.chutes.ai/e2e/instances/${chuteId}`) {
        return new Response(JSON.stringify({
          instances: [{
            instance_id: instanceId,
            e2e_pubkey: instancePublicKey.toString('base64'),
            nonces: [e2eNonce],
          }],
          nonce_expires_in: 60,
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }

      if (href === 'https://api.chutes.ai/e2e/invoke') {
        return new Response('mocked invoke response', { status: 409 });
      }

      throw new Error(`Unexpected fetch call: ${href}`);
    };

    try {
      const transport = new ChutesE2EEFetchTransport({ apiKey: 'cpk_test' });
      const res = await transport.fetch()('https://llm.chutes.ai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 10,
          stream: false,
        }),
      });

      assert.strictEqual(res.status, 409);

      const invokeCall = calls.find((call) => call.url === 'https://api.chutes.ai/e2e/invoke');
      assert.ok(invokeCall, 'expected /e2e/invoke to be called');
      assert.strictEqual(invokeCall.init.method, 'POST');
      assert.strictEqual(invokeCall.init.headers.Authorization, 'Bearer cpk_test');
      assert.strictEqual(invokeCall.init.headers['X-Chute-Id'], chuteId);
      assert.strictEqual(invokeCall.init.headers['X-Instance-Id'], instanceId);
      assert.strictEqual(invokeCall.init.headers['X-E2E-Nonce'], e2eNonce);
      assert.strictEqual(invokeCall.init.headers['X-E2E-Stream'], 'false');
      assert.strictEqual(invokeCall.init.headers['X-E2E-Path'], '/v1/chat/completions');
      assert.strictEqual(invokeCall.init.headers['Content-Type'], 'application/octet-stream');

      const encryptedBody = Buffer.from(invokeCall.init.body);
      assert.ok(encryptedBody.length > 1000, 'encrypted request body too small');
      assert.ok(!encryptedBody.includes(Buffer.from(prompt)), 'prompt leaked into encrypted request body');
      assert.deepStrictEqual(calls.map((call) => new URL(call.url).pathname), [
        '/v1/models',
        `/e2e/instances/${chuteId}`,
        '/e2e/invoke',
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// Lazy import — only needed when running live tests
let ChutesE2EEFetchTransport;
let buildE2EERequest;

describe.skipIf(!RUN_LIVE)('Chutes E2EE Live Integration', () => {
  it('should be importable', async () => {
    ({ default: ChutesE2EEFetchTransport } = await import('../../backend/src/services/ai/chutes/ChutesE2EEFetchTransport.js'));
    ({ buildE2EERequest } = await import('../../backend/src/services/ai/chutes/ChutesE2EECrypto.js'));
    assert.ok(ChutesE2EEFetchTransport, 'ChutesE2EEFetchTransport import failed');
    assert.ok(buildE2EERequest, 'buildE2EERequest import failed');
  });

  // Use a smaller model for most live checks; use Kimi for a separate reasoning response check.
  const FAST_MODEL = 'Qwen/Qwen3-32B-TEE';
  const REASONING_MODEL = 'moonshotai/Kimi-K2.5-TEE';

  it('should discover available models', async () => {
    const transport = new ChutesE2EEFetchTransport({ apiKey: API_KEY });
    const dm = transport._discovery;
    await dm._maybeRefreshModelMap();

    const models = [...dm._modelMap.keys()];
    assert.ok(models.length >= 5, `Expected >= 5 models, got ${models.length}`);
    assert.ok(models.some(m => m.includes('TEE')), 'Expected at least one TEE model');
  }, LIVE_TEST_TIMEOUT_MS);

  it('should resolve model name to chute_id', async () => {
    const transport = new ChutesE2EEFetchTransport({ apiKey: API_KEY });
    const chuteId = await transport._discovery.resolveChuteId(FAST_MODEL);
    assert.ok(chuteId, 'chute_id should be resolved');
    assert.strictEqual(chuteId.split('-').length, 5, 'chute_id should be a UUID');
  }, LIVE_TEST_TIMEOUT_MS);

  it('should fetch E2EE-capable instances', async () => {
    const transport = new ChutesE2EEFetchTransport({ apiKey: API_KEY });
    const chuteId = await transport._discovery.resolveChuteId(FAST_MODEL);
    const inst = await transport._discovery.getNonce(chuteId);

    assert.ok(inst.instanceId, 'missing instanceId');
    assert.ok(inst.e2ePubkey, 'missing e2ePubkey');
    assert.ok(inst.nonce, 'missing nonce');
    assert.ok(inst.e2ePubkey.length > 40, 'e2ePubkey looks too short');
  }, LIVE_TEST_TIMEOUT_MS);

  it('should build encrypted request blob without plaintext leakage', async () => {
    const transport = new ChutesE2EEFetchTransport({ apiKey: API_KEY });
    const chuteId = await transport._discovery.resolveChuteId(FAST_MODEL);
    const inst = await transport._discovery.getNonce(chuteId);

    const prompt = 'Secret test prompt 42 xyz';
    const payload = { model: FAST_MODEL, messages: [{ role: 'user', content: prompt }] };
    const { blob, responseSk } = await buildE2EERequest(inst.e2ePubkey, payload);

    assert.ok(blob.length > 1000, 'encrypted blob too small');
    assert.ok(responseSk.length > 1000, 'response secret key too small');

    // Security: prompt must NOT appear anywhere in the blob
    const asBinary = blob.toString('binary');
    assert.ok(!asBinary.includes(prompt), 'SECURITY: prompt found in plaintext blob');
    assert.ok(!blob.includes(Buffer.from(prompt)), 'SECURITY: prompt bytes found in blob');
  }, LIVE_TEST_TIMEOUT_MS);

  it('should complete non-streaming chat and return coherent English', async () => {
    const transport = new ChutesE2EEFetchTransport({ apiKey: API_KEY });
    const customFetch = transport.fetch();

    const res = await customFetch('https://api.chutes.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: FAST_MODEL,
        messages: [{ role: 'user', content: 'Say exactly: "encryption confirmed" and nothing else.' }],
        max_tokens: 20,
        stream: false,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.choices?.[0]?.message, 'missing message in response');
    const content = body.choices[0].message.content;
    assert.ok(typeof content === 'string', 'content should be a string');
    assert.ok(content.toLowerCase().includes('confirmed'), `expected "confirmed" in: ${content}`);
  }, LIVE_TEST_TIMEOUT_MS);

  it('should stream chat with valid SSE data lines', async () => {
    const transport = new ChutesE2EEFetchTransport({ apiKey: API_KEY });
    const customFetch = transport.fetch();

    const res = await customFetch('https://api.chutes.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: FAST_MODEL,
        messages: [{ role: 'user', content: 'Count: one two' }],
        max_tokens: 15,
        stream: true,
      }),
    });

    assert.strictEqual(res.status, 200);
    const ct = res.headers.get('content-type');
    assert.ok(ct?.includes('text/event-stream'), `expected SSE, got ${ct}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let dataLines = 0;

    for (let i = 0; i < 12; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim().startsWith('data:')) dataLines++;
      }
    }
    reader.releaseLock();
    assert.ok(dataLines > 0, 'expected at least one SSE data line');
  }, LIVE_TEST_TIMEOUT_MS);

  it('should work with reasoning model (Kimi-K2.5-TEE)', async () => {
    const transport = new ChutesE2EEFetchTransport({ apiKey: API_KEY });
    const customFetch = transport.fetch();

    const res = await customFetch('https://api.chutes.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: REASONING_MODEL,
        messages: [{ role: 'user', content: 'Confirm end-to-end encryption works in one word.' }],
        max_tokens: 30,
        stream: false,
      }),
    });

    assert.strictEqual(res.status, 200);
    const body = await res.json();
    const msg = body.choices?.[0]?.message;
    assert.ok(msg, 'missing message');

    // Reasoning models may output to reasoning_content instead of content
    const effective = msg.content || msg.reasoning_content;
    assert.ok(effective, 'neither content nor reasoning_content present');
    assert.ok(typeof effective === 'string', 'response should be a string');
    assert.ok(effective.length > 5, 'response too short');
  }, LIVE_TEST_TIMEOUT_MS);
});
