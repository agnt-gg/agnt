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
  getReasoningControl,
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

  // ── PRD-045 §5.2: capability undefined-vs-false ─────────────────────────
  // modelTransform must emit `undefined` (not `false`) for capability fields
  // when the provider response doesn't expose the underlying array. Coercing
  // unknown → false silently disables tool calling on dynamic models that
  // actually support it. The downstream guard fires only on `=== false`.

  it('modelTransform: missing supported_features → supportsTools/reasoning undefined', () => {
    const cfg = getProviderConfig('chutes');
    const raw = {
      id: 'example/Bare-Model',
      chute_id: '22222222-2222-4222-8222-222222222222',
      confidential_compute: true,
      // NOTE: no supported_features, no input_modalities
    };
    const transformed = cfg.modelTransform(raw);
    assert.strictEqual(transformed.supportsTools, undefined, 'tools should be unknown, not false');
    assert.strictEqual(transformed.reasoning, undefined, 'reasoning should be unknown, not false');
    assert.strictEqual(transformed.supportsVision, undefined, 'vision should be unknown, not false');
  });

  it('modelTransform: empty supported_features → supportsTools false (explicit)', () => {
    const cfg = getProviderConfig('chutes');
    const raw = {
      id: 'example/NoTools-Model',
      chute_id: '33333333-3333-4333-8333-333333333333',
      confidential_compute: true,
      supported_features: [],
      input_modalities: [],
    };
    const transformed = cfg.modelTransform(raw);
    assert.strictEqual(transformed.supportsTools, false, 'empty array means explicitly no tools');
    assert.strictEqual(transformed.reasoning, false, 'empty array means explicitly no reasoning');
    assert.strictEqual(transformed.supportsVision, false, 'empty array means explicitly no vision');
  });

  it('modelTransform: supported_features: [tools] → supportsTools true', () => {
    const cfg = getProviderConfig('chutes');
    const raw = {
      id: 'example/Tools-Model',
      chute_id: '44444444-4444-4444-8444-444444444444',
      confidential_compute: true,
      supported_features: ['tools'],
      input_modalities: ['text'],
    };
    const transformed = cfg.modelTransform(raw);
    assert.strictEqual(transformed.supportsTools, true);
    assert.strictEqual(transformed.reasoning, false, 'reasoning not in array → explicitly false');
    assert.strictEqual(transformed.supportsVision, false, 'image not in modalities → explicitly false');
  });

  it('registerDynamicPricingFromModels: undefined capability fields are not persisted as false', () => {
    registerDynamicPricingFromModels('chutes', [{
      id: 'example/Capability-Unknown',
      contextLength: 65536,
      inputCostPer1M: 0.10,
      outputCostPer1M: 0.20,
      // NOTE: supportsTools, reasoning, supportsVision all undefined
      chuteId: '55555555-5555-4555-8555-555555555555',
      confidentialCompute: true,
    }]);
    const metadata = getAllModelMetadata('chutes');
    const entry = metadata['example/Capability-Unknown'];
    assert.ok(entry, 'entry should be registered');
    assert.ok(!('supportsTools' in entry), 'supportsTools must not be persisted as false when undefined');
    assert.ok(!('reasoning' in entry), 'reasoning must not be persisted as false when undefined');
    assert.ok(!('supportsVision' in entry), 'supportsVision must not be persisted as false when undefined');
  });

  it('registerDynamicPricingFromModels: explicit false capability is preserved as false', () => {
    registerDynamicPricingFromModels('chutes', [{
      id: 'example/Tools-Disabled',
      contextLength: 65536,
      inputCostPer1M: 0.10,
      outputCostPer1M: 0.20,
      supportsTools: false,
      reasoning: false,
      supportsVision: false,
      chuteId: '66666666-6666-4666-8666-666666666666',
      confidentialCompute: true,
    }]);
    const metadata = getAllModelMetadata('chutes');
    const entry = metadata['example/Tools-Disabled'];
    assert.strictEqual(entry.supportsTools, false);
    assert.strictEqual(entry.reasoning, false);
    assert.strictEqual(entry.supportsVision, false);
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

describe('Chutes reasoning controls', () => {
  it('exposes a toggle UI for Kimi-TEE models', () => {
    const ctrl = getReasoningControl('chutes', 'moonshotai/Kimi-K2.6-TEE');
    assert.ok(ctrl, 'expected a control for Kimi-TEE');
    assert.strictEqual(ctrl.kind, 'toggle');
    const values = ctrl.options.map((o) => o.value);
    assert.deepStrictEqual(values.sort(), ['default', 'off']);
  });

  it('exposes a toggle UI for GLM-TEE models', () => {
    const ctrl = getReasoningControl('chutes', 'zai-org/GLM-5.1-TEE');
    assert.ok(ctrl);
    assert.strictEqual(ctrl.kind, 'toggle');
  });

  it('exposes a toggle UI for Qwen3-TEE models', () => {
    const ctrl = getReasoningControl('chutes', 'Qwen/Qwen3.6-27B-TEE');
    assert.ok(ctrl);
    assert.strictEqual(ctrl.kind, 'toggle');
  });

  it('returns null for non-reasoning Chutes models (MiniMax skipped on first pass)', () => {
    const ctrl = getReasoningControl('chutes', 'MiniMaxAI/MiniMax-M2.5-TEE');
    assert.strictEqual(ctrl, null, 'MiniMax should not yet have a reasoning control');
  });

  it('returns null for unknown chutes model IDs', () => {
    assert.strictEqual(getReasoningControl('chutes', 'unknown/Foo-TEE'), null);
  });
});

describe('Chutes reasoning body params (buildOpenAiLikeReasoningExtraBody)', () => {
  // Chutes hosts via vLLM / sglang — the disable-thinking protocol is unified
  // across all reasoning families: chat_template_kwargs.enable_thinking.
  // Model-native params (thinking.type, reasoning_effort) silently no-op.
  const OFF = { chat_template_kwargs: { enable_thinking: false } };
  const ON = { chat_template_kwargs: { enable_thinking: true } };

  it('Kimi-TEE: off → enable_thinking=false, on → true, default → null', async () => {
    const { buildOpenAiLikeReasoningExtraBody: fn } = await import(
      '../../backend/src/services/orchestrator/llmAdapters.js'
    );
    assert.deepStrictEqual(fn('chutes', 'moonshotai/Kimi-K2.6-TEE', 'off'), OFF);
    assert.deepStrictEqual(fn('chutes', 'moonshotai/Kimi-K2.6-TEE', 'on'), ON);
    assert.strictEqual(fn('chutes', 'moonshotai/Kimi-K2.6-TEE', 'default'), null);
  });

  it('GLM-TEE: off → enable_thinking=false, on → true, default → null', async () => {
    const { buildOpenAiLikeReasoningExtraBody: fn } = await import(
      '../../backend/src/services/orchestrator/llmAdapters.js'
    );
    assert.deepStrictEqual(fn('chutes', 'zai-org/GLM-5.1-TEE', 'off'), OFF);
    assert.deepStrictEqual(fn('chutes', 'zai-org/GLM-5.1-TEE', 'on'), ON);
    assert.strictEqual(fn('chutes', 'zai-org/GLM-5.1-TEE', 'default'), null);
  });

  it('Qwen3-TEE: off → enable_thinking=false, on → true, default → null', async () => {
    const { buildOpenAiLikeReasoningExtraBody: fn } = await import(
      '../../backend/src/services/orchestrator/llmAdapters.js'
    );
    assert.deepStrictEqual(fn('chutes', 'Qwen/Qwen3.6-27B-TEE', 'off'), OFF);
    assert.deepStrictEqual(fn('chutes', 'Qwen/Qwen3.6-27B-TEE', 'on'), ON);
    assert.strictEqual(fn('chutes', 'Qwen/Qwen3.6-27B-TEE', 'default'), null);
  });

  it('Non-reasoning chutes models (MiniMax) → null regardless of selection', async () => {
    const { buildOpenAiLikeReasoningExtraBody: fn } = await import(
      '../../backend/src/services/orchestrator/llmAdapters.js'
    );
    assert.strictEqual(fn('chutes', 'MiniMaxAI/MiniMax-M2.5-TEE', 'off'), null);
    assert.strictEqual(fn('chutes', 'MiniMaxAI/MiniMax-M2.5-TEE', 'on'), null);
  });
});

describe('ChutesE2EECrypto — fail-fast on auth failure', () => {
  it('chachaDecrypt: tampered ciphertext throws explicit Chutes E2EE error', async () => {
    const { chachaEncrypt, chachaDecrypt } = await import(
      '../../backend/src/services/ai/chutes/ChutesE2EECrypto.js'
    );
    const { randomBytes } = await import('crypto');

    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const plaintext = Buffer.from('top secret payload');
    const { ciphertext, tag } = chachaEncrypt(key, nonce, plaintext);

    // Tamper a ciphertext byte
    const tampered = Buffer.from(ciphertext);
    tampered[0] ^= 0xff;

    assert.throws(
      () => chachaDecrypt(key, nonce, tampered, tag),
      /Chutes E2EE authentication failed/,
      'tampered ciphertext must throw the explicit auth-failure error',
    );
  });

  it('chachaDecrypt: tampered tag throws explicit Chutes E2EE error', async () => {
    const { chachaEncrypt, chachaDecrypt } = await import(
      '../../backend/src/services/ai/chutes/ChutesE2EECrypto.js'
    );
    const { randomBytes } = await import('crypto');

    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const { ciphertext, tag } = chachaEncrypt(key, nonce, Buffer.from('hello'));

    const tamperedTag = Buffer.from(tag);
    tamperedTag[tamperedTag.length - 1] ^= 0x01;

    assert.throws(
      () => chachaDecrypt(key, nonce, ciphertext, tamperedTag),
      /Chutes E2EE authentication failed/,
    );
  });

  it('chachaDecrypt: round-trips clean plaintext unchanged', async () => {
    const { chachaEncrypt, chachaDecrypt } = await import(
      '../../backend/src/services/ai/chutes/ChutesE2EECrypto.js'
    );
    const { randomBytes } = await import('crypto');

    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const plaintext = Buffer.from('legitimate payload');
    const { ciphertext, tag } = chachaEncrypt(key, nonce, plaintext);
    const recovered = chachaDecrypt(key, nonce, ciphertext, tag);
    assert.strictEqual(recovered.toString('utf-8'), 'legitimate payload');
  });

  it('decryptStreamChunk: tampered chunk throws Chutes E2EE error (not gzip/buffer error)', async () => {
    const { chachaEncrypt, decryptStreamChunk } = await import(
      '../../backend/src/services/ai/chutes/ChutesE2EECrypto.js'
    );
    const { randomBytes } = await import('crypto');

    const streamKey = randomBytes(32);
    const nonce = randomBytes(12);
    const { ciphertext, tag } = chachaEncrypt(streamKey, nonce, Buffer.from('data: chunk\n\n'));
    const goodChunk = Buffer.concat([nonce, ciphertext, tag]);

    // Tamper the ciphertext region
    const tampered = Buffer.from(goodChunk);
    tampered[12] ^= 0x01; // first byte of ciphertext

    assert.throws(
      () => decryptStreamChunk(tampered.toString('base64'), streamKey),
      /Chutes E2EE authentication failed/,
      'streaming chunk must surface E2EE auth failure, not gzip/buffer coercion error',
    );
  });

  it('decryptResponse: tampered response blob throws Chutes E2EE error', async () => {
    const {
      buildE2EERequest,
      decryptResponse,
      generateKeyPair,
      decapsulate,
      deriveKey,
      chachaEncrypt,
    } = await import('../../backend/src/services/ai/chutes/ChutesE2EECrypto.js');
    const { randomBytes } = await import('crypto');
    const { gzipSync } = await import('zlib');

    // Build a real round-trip first
    const { pk: instancePk, sk: instanceSk } = await generateKeyPair();
    const { responseSk } = await buildE2EERequest(instancePk.toString('base64'), { hello: 'world' });

    // Server side: encrypt a response back to responseSk's pubkey would normally
    // happen on the provider. Simulate by encapsulating against the response pk.
    // Easier: just build a malformed blob — the MLKEM ciphertext will validate
    // but the symmetric tag will fail. Use a real-shape blob with corrupted tail.
    const { encapsulate } = await import('../../backend/src/services/ai/chutes/ChutesE2EECrypto.js');
    const responsePk = instancePk; // placeholder; we just need a valid encapsulation
    const { ct: mlkemCt, ss: sharedSecret } = await encapsulate(responsePk);
    const symKey = deriveKey(sharedSecret, mlkemCt, Buffer.from('e2e-resp-v1'));
    const nonce = randomBytes(12);
    const compressed = gzipSync(Buffer.from('{"valid":"json"}'));
    const { ciphertext, tag } = chachaEncrypt(symKey, nonce, compressed);

    // Tamper the tag
    const badTag = Buffer.from(tag);
    badTag[0] ^= 0xff;

    const blob = Buffer.concat([mlkemCt, nonce, ciphertext, badTag]);

    // Use the matching secret key (instanceSk corresponds to instancePk used as responsePk)
    await assert.rejects(
      decryptResponse(blob, instanceSk),
      /Chutes E2EE authentication failed/,
    );
  });
});

describe('ChutesDiscoveryManager.getNonce — concurrency', () => {
  it('returns distinct nonces to concurrent callers for the same chute', async () => {
    const { default: ChutesDiscoveryManager } = await import(
      '../../backend/src/services/ai/chutes/ChutesDiscoveryManager.js'
    );
    const manager = new ChutesDiscoveryManager({ apiKey: 'test' });

    let fetchCount = 0;
    manager._fetchInstances = async () => {
      fetchCount += 1;
      // Yield so all three callers can race past the cache check.
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        nonceExpiresAt: Date.now() + 60_000,
        instances: [
          {
            instanceId: 'inst-1',
            e2ePubkey: 'pubkey',
            nonces: ['nonce-a', 'nonce-b', 'nonce-c'],
          },
        ],
      };
    };

    const results = await Promise.all([
      manager.getNonce('chute-1'),
      manager.getNonce('chute-1'),
      manager.getNonce('chute-1'),
    ]);

    assert.strictEqual(fetchCount, 1, 'expected only one in-flight refresh');
    const nonces = results.map((r) => r.nonce);
    assert.strictEqual(new Set(nonces).size, 3, 'expected three distinct nonces');
  });

  it('parallel chuteIds refresh independently — no global serialization', async () => {
    const { default: ChutesDiscoveryManager } = await import(
      '../../backend/src/services/ai/chutes/ChutesDiscoveryManager.js'
    );
    const manager = new ChutesDiscoveryManager({ apiKey: 'test' });

    const seen = [];
    manager._fetchInstances = async (chuteId) => {
      seen.push(chuteId);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        nonceExpiresAt: Date.now() + 60_000,
        instances: [
          {
            instanceId: `inst-${chuteId}`,
            e2ePubkey: 'pubkey',
            nonces: [`nonce-${chuteId}`],
          },
        ],
      };
    };

    const [a, b] = await Promise.all([
      manager.getNonce('chute-A'),
      manager.getNonce('chute-B'),
    ]);

    assert.strictEqual(a.nonce, 'nonce-chute-A');
    assert.strictEqual(b.nonce, 'nonce-chute-B');
    assert.deepStrictEqual([...seen].sort(), ['chute-A', 'chute-B']);
  });

  it('drained shared cache forces one more refresh and bounded retries', async () => {
    const { default: ChutesDiscoveryManager } = await import(
      '../../backend/src/services/ai/chutes/ChutesDiscoveryManager.js'
    );
    const manager = new ChutesDiscoveryManager({ apiKey: 'test' });

    let fetchCount = 0;
    manager._fetchInstances = async () => {
      fetchCount += 1;
      // Always return one nonce — five concurrent callers will drain cache repeatedly.
      return {
        nonceExpiresAt: Date.now() + 60_000,
        instances: [
          {
            instanceId: 'inst-1',
            e2ePubkey: 'pubkey',
            nonces: [`nonce-${fetchCount}`],
          },
        ],
      };
    };

    // Fire five callers — first one wins immediately. Drained-cache retry path
    // is exercised by the others; bounded-retry guard prevents runaway recursion.
    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () => manager.getNonce('chute-1')),
    );

    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    const rejected = settled.filter((s) => s.status === 'rejected');

    // At least one caller succeeds; nonces from successes must all be distinct.
    assert.ok(fulfilled.length >= 1, 'expected at least one caller to succeed');
    const successNonces = fulfilled.map((s) => s.value.nonce);
    assert.strictEqual(
      new Set(successNonces).size,
      successNonces.length,
      'no two callers should ever receive the same nonce',
    );
    // Any rejection must be the explicit no-nonces error, not a runaway crash.
    for (const r of rejected) {
      assert.match(r.reason.message, /No nonces available/);
    }
  });

  it('failed refresh clears in-flight slot so retries can proceed', async () => {
    const { default: ChutesDiscoveryManager } = await import(
      '../../backend/src/services/ai/chutes/ChutesDiscoveryManager.js'
    );
    const manager = new ChutesDiscoveryManager({ apiKey: 'test' });

    let attempt = 0;
    manager._fetchInstances = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('simulated network blip');
      }
      return {
        nonceExpiresAt: Date.now() + 60_000,
        instances: [
          {
            instanceId: 'inst-1',
            e2ePubkey: 'pubkey',
            nonces: ['nonce-recovered'],
          },
        ],
      };
    };

    await assert.rejects(manager.getNonce('chute-1'), /simulated network blip/);
    const ok = await manager.getNonce('chute-1');
    assert.strictEqual(ok.nonce, 'nonce-recovered');
    assert.strictEqual(attempt, 2);
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
