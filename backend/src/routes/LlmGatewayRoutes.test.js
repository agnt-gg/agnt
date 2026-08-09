/**
 * CONTRACT for the loopback LLM gateway.
 *
 * Boots the real router over a real socket, because two of the properties under
 * test — "a stranger cannot call this" and "a screenshot actually reaches the
 * adapter" — are invisible if you call the handler function directly.
 *
 * THE ASSERTION THAT MATTERS MOST is `served the provider the GRANT names`.
 * A provider-level test that silently runs against a different provider than
 * the one it claims is worse than no test: it manufactures confidence. That
 * exact failure poisoned four of twelve probes in the earlier provider-cache
 * audit, where five providers with no API key failed over to another vendor and
 * the numbers were recorded as if they were real.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';

const adapterCalls = [];
const clientCalls = [];
let nextAdapterResult;

vi.mock('../services/ai/LlmService.js', () => ({
  createLlmClient: vi.fn(async (provider, userId) => {
    clientCalls.push({ provider, userId });
    return { __fake: provider };
  }),
}));

vi.mock('../services/orchestrator/llmAdapters.js', () => ({
  createLlmAdapter: vi.fn(async (provider, client, model) => ({
    callStream: async (messages, tools, onChunk, context) => {
      adapterCalls.push({ provider, model, messages, tools, context });
      return nextAdapterResult;
    },
  })),
}));

const { default: LlmGatewayRoutes } = await import('./LlmGatewayRoutes.js');
const {
  mintGatewayToken,
  _resetGatewayTokens,
} = await import('../services/ai/localGatewayTokens.js');

let server;
let base;

const post = (body, token) => fetch(`${base}/api/llm/v1/chat/completions`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  },
  body: JSON.stringify(body),
});

const grant = (overrides = {}) => mintGatewayToken({
  userId: 'user-1',
  provider: 'claude-code',
  model: 'claude-sonnet-5',
  label: 'test',
  ...overrides,
}).token;

const userTurn = (text) => ({ role: 'user', content: text });

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use('/api/llm', LlmGatewayRoutes);
  await new Promise((resolve) => { server = http.createServer(app).listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => { await new Promise((r) => server.close(r)); });

beforeEach(() => {
  _resetGatewayTokens();
  adapterCalls.length = 0;
  clientCalls.length = 0;
  nextAdapterResult = {
    responseMessage: { role: 'assistant', content: 'done' },
    toolCalls: [],
    usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
  };
});

describe('gateway authentication', () => {
  it('refuses a caller with no token', async () => {
    const res = await post({ model: 'claude-sonnet-5', messages: [userTurn('hi')] });
    expect(res.status).toBe(401);
    expect(adapterCalls).toHaveLength(0);
  });

  it('refuses a token it never minted', async () => {
    const res = await post({ model: 'claude-sonnet-5', messages: [userTurn('hi')] }, 'made-up');
    expect(res.status).toBe(401);
    expect(adapterCalls).toHaveLength(0);
  });

  it('refuses a revoked token', async () => {
    const token = grant();
    const { revokeGatewayToken } = await import('../services/ai/localGatewayTokens.js');
    revokeGatewayToken(token);

    const res = await post({ model: 'claude-sonnet-5', messages: [userTurn('hi')] }, token);
    expect(res.status).toBe(401);
  });
});

describe('the grant, not the request, decides what runs', () => {
  it('serves the provider and model the grant names', async () => {
    const token = grant({ provider: 'gemini-cli', model: 'gemini-3-pro-preview' });
    const res = await post({ model: 'gemini-3-pro-preview', messages: [userTurn('hi')] }, token);

    expect(res.status).toBe(200);
    // Not "a provider was used" — THE provider the grant named.
    expect(clientCalls).toEqual([{ provider: 'gemini-cli', userId: 'user-1' }]);
    expect(adapterCalls[0]).toMatchObject({ provider: 'gemini-cli', model: 'gemini-3-pro-preview' });
    expect((await res.json()).model).toBe('gemini-3-pro-preview');
  });

  it('rejects a request for a model the grant does not cover', async () => {
    const token = grant({ model: 'claude-haiku-5' });
    const res = await post({ model: 'claude-opus-5', messages: [userTurn('hi')] }, token);

    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/bound to model "claude-haiku-5"/);
    expect(adapterCalls).toHaveLength(0);
  });

  it('refuses streaming rather than faking it', async () => {
    const res = await post({ model: 'claude-sonnet-5', messages: [userTurn('hi')], stream: true }, grant());
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/does not implement streaming/);
  });

  it('rejects an empty conversation', async () => {
    const res = await post({ model: 'claude-sonnet-5', messages: [] }, grant());
    expect(res.status).toBe(400);
  });
});

describe('screenshots reach the adapter', () => {
  const png = 'iVBORw0KGgoAAAANSUhEUg==';

  it('moves inline images onto the imageData channel and flattens the text', async () => {
    const res = await post({
      model: 'claude-sonnet-5',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'what is on screen?' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } },
        ],
      }],
    }, grant());

    expect(res.status).toBe(200);
    const [call] = adapterCalls;

    // Our adapters never read image parts out of message content — each one
    // injects images itself from context.imageData. Leaving the part in place
    // is how a screenshot silently becomes nothing at all.
    expect(call.context.imageData).toEqual([{ type: 'image/png', data: png }]);
    expect(call.messages[0].content).toBe('what is on screen?');
    expect(JSON.stringify(call.messages)).not.toContain('image_url');
  });

  it('forwards only the current turn, not every screenshot in history', async () => {
    const image = (n) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${n}` } });
    const res = await post({
      model: 'claude-sonnet-5',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'step 1' }, image('AAAA')] },
        { role: 'assistant', content: 'clicked' },
        { role: 'user', content: [{ type: 'text', text: 'step 2' }, image('BBBB')] },
      ],
    }, grant());

    expect(res.status).toBe(200);
    expect(adapterCalls[0].context.imageData).toEqual([{ type: 'image/png', data: 'BBBB' }]);
  });

  it('does not fetch remote image URLs', async () => {
    const res = await post({
      model: 'claude-sonnet-5',
      messages: [{
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'http://169.254.169.254/latest/meta-data/' } }],
      }],
    }, grant());

    expect(res.status).toBe(200);
    // An endpoint that dereferenced this would be an SSRF primitive for
    // whatever spawned the child process holding the token.
    expect(adapterCalls[0].context.imageData).toBeUndefined();
    expect(adapterCalls[0].messages[0].content).toMatch(/only accepts inline data/);
  });
});

describe('an upstream failure is a failure, not a reply', () => {
  const notice = (text) => {
    nextAdapterResult = {
      responseMessage: { role: 'assistant', content: text },
      toolCalls: [],
      usage: {},
    };
    return post({ model: 'claude-sonnet-5', messages: [userTurn('go')] }, grant());
  };

  it('rejects an adapter error notice returned as assistant content', async () => {
    // Captured live through this route from Antigravity and Chutes. Several of
    // our adapters catch upstream errors and return a human-readable notice as
    // content — right for a chat window, poison for an agent loop, which would
    // treat it as the model's considered answer and keep stepping.
    const res = await notice('⚠️ **Gemini API Error:** quota exceeded\n\nPlease check your API configuration.');

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('upstream_error_notice');
    expect(body.error.message).toMatch(/quota exceeded/);
  });

  it('rejects a dropped-connection notice too', async () => {
    const res = await notice('⚠️ **Connection dropped:** The provider closed the stream.');
    expect(res.status).toBe(502);
  });

  it('does not mistake a genuine reply that mentions an error', async () => {
    const res = await notice('The page shows ⚠️ **Error 404** in red text near the header.');
    expect(res.status).toBe(200);
    expect((await res.json()).choices[0].message.content).toMatch(/404/);
  });

  it('lets a tool call through even when text looks like a notice', async () => {
    nextAdapterResult = {
      responseMessage: { role: 'assistant', content: '⚠️ **API Error:** transient' },
      toolCalls: [{ id: 'c1', function: { name: 'click', arguments: '{}' } }],
      usage: {},
    };
    const res = await post({ model: 'claude-sonnet-5', messages: [userTurn('go')] }, grant());
    expect(res.status).toBe(200);
  });
});

describe('structured output', () => {
  const schemaRequest = (content) => {
    nextAdapterResult = {
      responseMessage: { role: 'assistant', content },
      toolCalls: [],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    return post({
      model: 'claude-sonnet-5',
      messages: [{ role: 'system', content: 'you are an agent' }, userTurn('extract')],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'agent_output', strict: true, schema: { type: 'object', properties: { done: { type: 'boolean' } } } },
      },
    }, grant());
  };

  it('states the schema in the system turn', async () => {
    await schemaRequest('{"done": true}');
    expect(adapterCalls[0].messages[0].role).toBe('system');
    expect(adapterCalls[0].messages[0].content).toMatch(/single JSON object/);
    expect(adapterCalls[0].messages[0].content).toContain('"done"');
  });

  it('unwraps a fenced reply into bare JSON', async () => {
    const res = await schemaRequest('Sure!\n```json\n{"done": true}\n```\n');
    const body = await res.json();
    expect(res.status).toBe(200);
    // browser-use hands this straight to model_validate_json; anything but
    // pure JSON raises inside the agent loop.
    expect(JSON.parse(body.choices[0].message.content)).toEqual({ done: true });
  });

  it('survives braces inside string values', async () => {
    const res = await schemaRequest('{"note": "a } and a { in prose", "done": false}');
    const body = await res.json();
    expect(JSON.parse(body.choices[0].message.content)).toEqual({ note: 'a } and a { in prose', done: false });
  });

  it('fails loudly when the model answers with prose', async () => {
    const res = await schemaRequest('I could not find the button, sorry.');
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe('structured_output_unparseable');
    expect(body.error.message).toMatch(/I could not find the button/);
  });
});

describe('OpenAI response shape', () => {
  it('returns a chat.completion with usage', async () => {
    const res = await post({ model: 'claude-sonnet-5', messages: [userTurn('hi')] }, grant());
    const body = await res.json();

    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message).toEqual({ role: 'assistant', content: 'done' });
    expect(body.choices[0].finish_reason).toBe('stop');
    expect(body.usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 });
  });

  it('reports tool calls with finish_reason tool_calls', async () => {
    nextAdapterResult = {
      responseMessage: { role: 'assistant', content: '' },
      toolCalls: [{ id: 'call_1', function: { name: 'click', arguments: '{"index":3}' } }],
      usage: {},
    };
    const res = await post({ model: 'claude-sonnet-5', messages: [userTurn('hi')] }, grant());
    const body = await res.json();

    expect(body.choices[0].finish_reason).toBe('tool_calls');
    expect(body.choices[0].message.tool_calls[0]).toEqual({
      id: 'call_1',
      type: 'function',
      function: { name: 'click', arguments: '{"index":3}' },
    });
  });

  it('turns an adapter failure into a 502 that names the provider and model', async () => {
    nextAdapterResult = null; // makes the destructure inside the handler throw
    const res = await post({ model: 'claude-sonnet-5', messages: [userTurn('hi')] }, grant());
    expect(res.status).toBe(502);
    expect((await res.json()).error.message).toMatch(/claude-code\/claude-sonnet-5 failed/);
  });
});
