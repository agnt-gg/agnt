import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamError, createRequestFetch } from './connectionRuntime.js';
import { AnthropicAdapter } from '../orchestrator/llmAdapters.js';

const encoder = new TextEncoder();

function sseResponse(chunks, headers = {}) {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) return controller.close();
      controller.enqueue(encoder.encode(chunks[index++]));
    },
  }), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

async function readBody(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) return text + decoder.decode();
    text += decoder.decode(value, { stream: true });
  }
}

describe('createRequestFetch stream error preservation', () => {
  it('preserves an overloaded_error and request_id split across transport chunks', async () => {
    const baseFetch = vi.fn(async () => sseResponse([
      'event: error\ndata: {"type":"error","error":{"type":"over',
      'loaded_error","message":"Overloaded"},"request_id":"req_123"}\n\n',
    ]));

    const response = await createRequestFetch(baseFetch)('https://api.example.test/v1/messages', {});

    await expect(readBody(response)).rejects.toMatchObject({
      name: 'StreamError',
      status: 529,
      type: 'overloaded_error',
      requestId: 'req_123',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    });
  });

  it('maps rate_limit_error to 429 and falls back to the response request-id header', async () => {
    const baseFetch = vi.fn(async () => sseResponse([
      'event: error\ndata: {"error":{"type":"rate_limit_error","message":"Slow down"}}\n\n',
    ], { 'request-id': 'req_header' }));

    const response = await createRequestFetch(baseFetch)('https://api.example.test/v1/messages', {});

    await expect(readBody(response)).rejects.toEqual(expect.objectContaining({
      status: 429,
      type: 'rate_limit_error',
      requestId: 'req_header',
    }));
  });

  it('passes ordinary SSE frames through unchanged', async () => {
    const body = [
      'event: message_start\ndata: {"type":"message_start"}\n\n',
      'event: ping\ndata: {}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const response = await createRequestFetch(async () => sseResponse(body))(
      'https://api.example.test/v1/messages',
      {}
    );

    await expect(readBody(response)).resolves.toBe(body.join(''));
  });

  it('leaves non-SSE responses untouched', async () => {
    const original = new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const response = await createRequestFetch(async () => original)(
      'https://api.example.test/v1/messages',
      {}
    );

    expect(response).toBe(original);
  });

  it('exposes a stable error shape for adapter retry classification and diagnostics', () => {
    const error = new StreamError({
      error: { type: 'overloaded_error', message: 'Overloaded' },
      request_id: 'req_shape',
    });

    expect(error.message).toContain('529 overloaded_error: Overloaded');
    expect(error.message).toContain('req_shape');
    expect(error.status).toBe(529);
  });

  it('is retryable and honors the upstream Retry-After delay floor', () => {
    const adapter = new AnthropicAdapter({ messages: {} }, 'claude-opus-5', 'claude-code');
    const error = new StreamError(
      { error: { type: 'overloaded_error', message: 'Overloaded' }, request_id: 'req_retry' },
      new Headers({ 'retry-after': '7' })
    );

    expect(adapter.isRetryableError(error)).toBe(true);
    expect(adapter.calculateDelay(0)).toBe(7000);
  });
});

/**
 * The signature carries a client version, and that version must be sourced,
 * never a literal of this module's own: a stale constant ages out of date.
 *
 * These tests pin the invariant that prevents a rerun: the signature reports
 * whatever clientVersions.js resolves.
 *
 * They also guard the suffix ALGORITHM, which the wire oracle deliberately
 * masks (see tests/provider-oracle/capture.js) so that an upstream release
 * cannot turn it red.
 */


const { resolved } = vi.hoisted(() => ({ resolved: { version: '2.1.257' } }));

vi.mock('./clientVersions.js', () => ({
  getCachedClientVersion: vi.fn((key) => {
    if (key !== 'claude-code') throw new Error(`unexpected key: ${key}`);
    return resolved.version;
  }),
}));

const { getCachedClientVersion } = await import('./clientVersions.js');
const { buildSigningBlock, buildSigningText, computeSignatureSuffix } =
  await import('./connectionRuntime.js');

/** Pull the version and suffix back out of a rendered signature. */
function parseSignature(text) {
  const match = /cc_version=(\d+(?:\.\d+)*)\.([0-9a-f]{3});/.exec(text);
  if (!match) throw new Error(`signature did not match the expected shape: ${text}`);
  return { version: match[1], suffix: match[2] };
}

beforeEach(() => {
  resolved.version = '2.1.257';
  getCachedClientVersion.mockClear();
});

describe('signature version is sourced, not hardcoded', () => {
  it('embeds the version clientVersions resolves', () => {
    const { text } = buildSigningBlock('hello world, this is a long message');
    expect(parseSignature(text).version).toBe('2.1.257');
    expect(getCachedClientVersion).toHaveBeenCalledWith('claude-code');
  });

  it('follows an upstream bump with no code change — the actual regression', () => {
    const before = parseSignature(buildSigningBlock('same message every time').text);

    // A new release ships; the npm-backed resolver picks it up.
    resolved.version = '2.1.999';
    const after = parseSignature(buildSigningBlock('same message every time').text);

    expect(before.version).toBe('2.1.257');
    expect(after.version).toBe('2.1.999');
    // The suffix is a hash OVER the version, so it must move with it.
    expect(after.suffix).not.toBe(before.suffix);
  });

  it('never emits a stale literal', () => {
    resolved.version = '2.1.999';
    expect(buildSigningBlock('a message long enough to index').text).not.toContain('2.1.92');
  });

  it('keeps the rest of the signature shape intact', () => {
    const { type, text } = buildSigningBlock('a message long enough to index');
    expect(type).toBe('text');
    expect(text).toMatch(
      /^x-anthropic-billing-header: cc_version=\d+(\.\d+)*\.[0-9a-f]{3}; cc_entrypoint=cli; cch=00000;$/
    );
  });
});

describe('the version and its suffix are pinned to each other', () => {
  it('pairs the suffix with the version in the same signature when the cache refreshes mid-build', () => {
    // Simulate a background refresh landing between two reads: if the signature
    // resolved the version twice, it would hash over 2.1.257 and print 2.1.999.
    let call = 0;
    getCachedClientVersion.mockImplementation(() => (call++ === 0 ? '2.1.257' : '2.1.999'));

    const { text } = buildSigningBlock('a message long enough to index');
    const { version, suffix } = parseSignature(text);

    expect(suffix).toBe(computeSignatureSuffix('a message long enough to index', version));
    expect(getCachedClientVersion).toHaveBeenCalledTimes(1);
  });

  it('lets a caller pin both explicitly', () => {
    const suffix = computeSignatureSuffix('a message long enough to index', '3.0.0');
    expect(buildSigningText(suffix, '3.0.0')).toContain(`cc_version=3.0.0.${suffix}`);
  });
});

describe('suffix algorithm — masked in the wire oracle, guarded here', () => {
  const base = 'abcdefghijklmnopqrstuvwxyz';

  it('is derived from characters 4, 7 and 20 of the first user message', () => {
    for (const index of [4, 7, 20]) {
      const mutated = base.slice(0, index) + 'Z' + base.slice(index + 1);
      expect(
        computeSignatureSuffix(mutated, '2.1.257'),
        `character ${index} must feed the suffix`
      ).not.toBe(computeSignatureSuffix(base, '2.1.257'));
    }
  });

  it('ignores characters outside those indices', () => {
    for (const index of [0, 5, 12, 25]) {
      const mutated = base.slice(0, index) + 'Z' + base.slice(index + 1);
      expect(
        computeSignatureSuffix(mutated, '2.1.257'),
        `character ${index} must NOT feed the suffix`
      ).toBe(computeSignatureSuffix(base, '2.1.257'));
    }
  });

  it('pads a short message with zeroes instead of throwing', () => {
    expect(computeSignatureSuffix('', '2.1.257')).toMatch(/^[0-9a-f]{3}$/);
    // Both are shorter than index 4, so both pad to the same three zeroes.
    expect(computeSignatureSuffix('hi', '2.1.257')).toBe(computeSignatureSuffix('0000', '2.1.257'));
  });
});
