import { describe, expect, it, vi } from 'vitest';
import { AnthropicSseError, createCchFetch } from './claudeBillingHeader.js';
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

describe('createCchFetch SSE error preservation', () => {
  it('preserves an overloaded_error and request_id split across transport chunks', async () => {
    const baseFetch = vi.fn(async () => sseResponse([
      'event: error\ndata: {"type":"error","error":{"type":"over',
      'loaded_error","message":"Overloaded"},"request_id":"req_123"}\n\n',
    ]));

    const response = await createCchFetch(baseFetch)('https://api.anthropic.com/v1/messages', {});

    await expect(readBody(response)).rejects.toMatchObject({
      name: 'AnthropicSseError',
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

    const response = await createCchFetch(baseFetch)('https://api.anthropic.com/v1/messages', {});

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
    const response = await createCchFetch(async () => sseResponse(body))(
      'https://api.anthropic.com/v1/messages',
      {}
    );

    await expect(readBody(response)).resolves.toBe(body.join(''));
  });

  it('leaves non-SSE responses untouched', async () => {
    const original = new Response('{"ok":true}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const response = await createCchFetch(async () => original)(
      'https://api.anthropic.com/v1/messages',
      {}
    );

    expect(response).toBe(original);
  });

  it('exposes a stable error shape for adapter retry classification and diagnostics', () => {
    const error = new AnthropicSseError({
      error: { type: 'overloaded_error', message: 'Overloaded' },
      request_id: 'req_shape',
    });

    expect(error.message).toContain('529 overloaded_error: Overloaded');
    expect(error.message).toContain('req_shape');
    expect(error.status).toBe(529);
  });

  it('is retryable and honors the upstream Retry-After delay floor', () => {
    const adapter = new AnthropicAdapter({ messages: {} }, 'claude-opus-5', 'claude-code');
    const error = new AnthropicSseError(
      { error: { type: 'overloaded_error', message: 'Overloaded' }, request_id: 'req_retry' },
      new Headers({ 'retry-after': '7' })
    );

    expect(adapter.isRetryableError(error)).toBe(true);
    expect(adapter.calculateDelay(0)).toBe(7000);
  });
});
