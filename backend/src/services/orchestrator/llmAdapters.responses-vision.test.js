import { describe, expect, it } from 'vitest';
import { createLlmAdapter } from './llmAdapters.js';

// Capture the request payload sent to client.responses.create so we can assert
// input_image blocks were injected. Returns a stub stream with no content.
function capturingClient(seenParams) {
  return {
    responses: {
      create: async (params) => {
        seenParams.push(params);
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'response.completed',
              response: { id: 'resp_1', output: [], usage: { input_tokens: 1, output_tokens: 1 } },
            };
          },
        };
      },
    },
  };
}

const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9ZdU0v8AAAAASUVORK5CYII=';

// First test in the file pays one-time cost of importing llmAdapters.js
// (which transitively imports DB init, ProviderRegistry, etc.). Give it room.
describe('OpenAIResponsesAdapter image injection', { timeout: 30000 }, () => {
  it('appends input_image to the last user message when imageData is provided', async () => {
    const seen = [];
    const adapter = await createLlmAdapter('openai', capturingClient(seen), 'gpt-5.2');

    await adapter.callStream(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'what is in this image?' },
      ],
      [],
      () => {},
      {
        imageData: [{ type: 'image/png', data: tinyPng, filename: 'test.png' }],
      },
    );

    expect(seen).toHaveLength(1);
    const userItem = seen[0].input.find((i) => i.type === 'message' && i.role === 'user');
    expect(userItem).toBeDefined();
    expect(userItem.content).toEqual(
      expect.arrayContaining([
        { type: 'input_text', text: 'what is in this image?' },
        { type: 'input_image', image_url: `data:image/png;base64,${tinyPng}` },
      ]),
    );
  });

  it('skips images marked unsupported and does not break the call', async () => {
    const seen = [];
    const adapter = await createLlmAdapter('openai', capturingClient(seen), 'gpt-5.2');

    await adapter.callStream(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ],
      [],
      () => {},
      {
        imageData: [{ type: 'image/bmp', data: 'aGVsbG8=', filename: 'foo.bmp', unsupported: true }],
      },
    );

    expect(seen).toHaveLength(1);
    const userItem = seen[0].input.find((i) => i.type === 'message' && i.role === 'user');
    expect(userItem.content).toEqual([{ type: 'input_text', text: 'hello' }]);
  });

  it('does not inject anything when no imageData is provided (text-only regression check)', async () => {
    const seen = [];
    const adapter = await createLlmAdapter('openai', capturingClient(seen), 'gpt-5.2');

    await adapter.callStream(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
      [],
      () => {},
      {},
    );

    expect(seen).toHaveLength(1);
    const userItem = seen[0].input.find((i) => i.type === 'message' && i.role === 'user');
    expect(userItem.content).toEqual([{ type: 'input_text', text: 'hi' }]);
  });
});

describe('CodexResponsesAdapter image injection', { timeout: 30000 }, () => {
  it('forwards imageData through _buildCodexParams to the Responses input', async () => {
    const seen = [];
    const adapter = await createLlmAdapter('openai-codex', capturingClient(seen), 'gpt-5.2-codex');

    await adapter.callStream(
      [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'codex, see this' },
      ],
      [],
      () => {},
      {
        imageData: [{ type: 'image/png', data: tinyPng, filename: 'test.png' }],
      },
    );

    expect(seen).toHaveLength(1);
    const userItem = seen[0].input.find((i) => i.type === 'message' && i.role === 'user');
    expect(userItem).toBeDefined();
    expect(userItem.content).toEqual(
      expect.arrayContaining([
        { type: 'input_text', text: 'codex, see this' },
        { type: 'input_image', image_url: `data:image/png;base64,${tinyPng}` },
      ]),
    );
  });
});
