import { describe, expect, it } from 'vitest';
import { createLlmAdapter } from './llmAdapters.js';

function streamFrom(events) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
  };
}

describe('CodexResponsesAdapter', () => {
  it('replays encrypted reasoning output before tool results in stateless Responses requests', async () => {
    const responseOutput = [
      {
        id: 'rs_123',
        type: 'reasoning',
        summary: [],
        encrypted_content: 'encrypted-reasoning-state',
        status: 'completed',
      },
      {
        id: 'fc_123',
        type: 'function_call',
        call_id: 'call_123',
        name: 'get_agnt_api',
        arguments: '{"section":"auth"}',
        status: 'completed',
      },
    ];
    const client = {
      responses: {
        create: async () => streamFrom([
          {
            type: 'response.output_item.added',
            item: { type: 'function_call', call_id: 'call_123', name: 'get_agnt_api' },
          },
          {
            type: 'response.function_call_arguments.delta',
            delta: '{"section":"auth"}',
          },
          {
            type: 'response.completed',
            response: { id: 'resp_123', output: responseOutput, usage: { input_tokens: 1, output_tokens: 2 } },
          },
        ]),
      },
    };

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    const first = await adapter.callStream(
      [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Check auth providers' },
      ],
      [{ type: 'function', function: { name: 'get_agnt_api', parameters: { type: 'object' } } }],
      () => {},
    );

    expect(first.responseMessage._responsesOutputItems).toEqual(responseOutput);

    const toolResults = adapter.formatToolResults([
      {
        tool_call_id: 'call_123',
        role: 'tool',
        name: 'get_agnt_api',
        content: '{"success":true,"reference":"auth endpoints"}',
      },
    ]);

    const followUpParams = adapter._buildCodexParams(
      [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Check auth providers' },
        first.responseMessage,
        ...toolResults,
      ],
      [],
    );

    expect(followUpParams.input.map((item) => item.type)).toEqual([
      'message',
      'reasoning',
      'function_call',
      'function_call_output',
    ]);
    expect(followUpParams.input[1]).toMatchObject({
      type: 'reasoning',
      id: 'rs_123',
      encrypted_content: 'encrypted-reasoning-state',
    });
    expect(followUpParams.input[2]).toMatchObject({
      type: 'function_call',
      call_id: 'call_123',
      name: 'get_agnt_api',
    });
    expect(followUpParams.input[3]).toMatchObject({
      type: 'function_call_output',
      call_id: 'call_123',
      output: '{"success":true,"reference":"auth endpoints"}',
    });
  });

  it('does not suggest OAuth reconnect for upstream overload errors', async () => {
    const client = {
      responses: {
        create: async () => {
          const error = new Error('Our servers are currently overloaded. Please try again later.');
          error.status = 503;
          throw error;
        },
      },
    };
    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    adapter.maxRetries = 0;

    const result = await adapter.callStream([{ role: 'user', content: 'hi' }], [], () => {});

    expect(result.responseMessage.content).toContain('overloaded');
    expect(result.responseMessage.content).not.toContain('Please check your OAuth connection');
    expect(result.responseMessage.content).not.toContain('reconnect your OAuth account');
  });

  it('sheds oversized replayed Codex output before sending the request', async () => {
    let capturedParams;
    const hugeArguments = JSON.stringify({ code: 'x'.repeat(520_000) });
    const client = {
      responses: {
        create: async (params) => {
          capturedParams = params;
          return streamFrom([
            {
              type: 'response.completed',
              response: {
                id: 'resp_trimmed',
                output: [
                  {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'trimmed ok' }],
                  },
                ],
              },
            },
          ]);
        },
      },
    };

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    await adapter.callStream(
      [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Old request' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_huge',
              type: 'function',
              function: { name: 'execute_javascript_code', arguments: hugeArguments },
            },
          ],
          _responsesOutputItems: [
            {
              type: 'function_call',
              call_id: 'call_huge',
              name: 'execute_javascript_code',
              arguments: hugeArguments,
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_huge',
          name: 'execute_javascript_code',
          content: '{"success":true,"stdout":"ok"}',
        },
        { role: 'user', content: 'Current request' },
      ],
      [{ type: 'function', function: { name: 'execute_javascript_code', parameters: { type: 'object' } } }],
      () => {},
    );

    expect(capturedParams.input).toHaveLength(1);
    expect(capturedParams.input[0]).toMatchObject({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Current request' }],
    });
  });

  it('retries Codex streams that fail with terminated', async () => {
    let attempts = 0;
    const client = {
      responses: {
        create: async () => {
          attempts++;
          if (attempts === 1) {
            throw new Error('terminated');
          }
          return streamFrom([
            {
              type: 'response.output_text.delta',
              delta: 'retry ok',
            },
            {
              type: 'response.completed',
              response: {
                id: 'resp_retry',
                output: [
                  {
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'output_text', text: 'retry ok' }],
                  },
                ],
              },
            },
          ]);
        },
      },
    };

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    adapter.baseDelay = 1;

    const result = await adapter.callStream([{ role: 'user', content: 'hi' }], [], () => {});

    expect(attempts).toBe(2);
    expect(result.responseMessage.content).toBe('retry ok');
  });
});

describe('OpenAIResponsesAdapter', () => {
  it('requests and replays encrypted reasoning output for streamed stateless tool loops', async () => {
    let capturedParams;
    const responseOutput = [
      {
        id: 'rs_openai',
        type: 'reasoning',
        summary: [],
        encrypted_content: 'openai-encrypted-reasoning-state',
        status: 'completed',
      },
      {
        id: 'fc_openai',
        type: 'function_call',
        call_id: 'call_openai',
        name: 'get_agnt_api',
        arguments: '{}',
        status: 'completed',
      },
    ];
    const client = {
      responses: {
        create: async (params) => {
          capturedParams = params;
          return streamFrom([
            {
              type: 'response.output_item.added',
              item: { type: 'function_call', call_id: 'call_openai', name: 'get_agnt_api' },
            },
            {
              type: 'response.function_call_arguments.delta',
              delta: '{}',
            },
            {
              type: 'response.completed',
              response: { id: 'resp_openai', output: responseOutput },
            },
          ]);
        },
      },
    };

    const adapter = await createLlmAdapter('openai', client, 'gpt-5.5');
    const first = await adapter.callStream(
      [{ role: 'user', content: 'Check auth providers' }],
      [{ type: 'function', function: { name: 'get_agnt_api', parameters: { type: 'object' } } }],
      () => {},
    );

    expect(capturedParams).toMatchObject({
      store: false,
      stream: true,
      include: ['reasoning.encrypted_content'],
    });
    expect(first.responseMessage._responsesOutputItems).toEqual(responseOutput);

    const followUpInput = adapter._transformMessagesToInput([
      { role: 'user', content: 'Check auth providers' },
      first.responseMessage,
      {
        role: 'tool',
        tool_call_id: 'call_openai',
        content: '{"success":true}',
        name: 'get_agnt_api',
      },
    ]).input;

    expect(followUpInput.map((item) => item.type)).toEqual([
      'message',
      'reasoning',
      'function_call',
      'function_call_output',
    ]);
    expect(followUpInput[1]).toMatchObject({
      type: 'reasoning',
      encrypted_content: 'openai-encrypted-reasoning-state',
    });
  });
});
