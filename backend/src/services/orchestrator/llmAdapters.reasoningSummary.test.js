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

/** Records every request param object the adapter sends. */
function recordingClient(streamFactory) {
  const calls = [];
  return {
    calls,
    responses: {
      create: async (params) => {
        calls.push(params);
        return streamFactory(calls.length);
      },
    },
  };
}

function collect(onChunkTypes = ['reasoning']) {
  const chunks = [];
  const onChunk = (chunk) => {
    if (onChunkTypes.includes(chunk.type)) chunks.push(chunk);
  };
  return { chunks, onChunk };
}

const completed = (output = []) => ({
  type: 'response.completed',
  response: { id: 'resp_1', output, usage: { input_tokens: 1, output_tokens: 2 } },
});

describe('reasoning summary streaming (Codex)', () => {
  it('forwards reasoning summary deltas as reasoning chunks, in order, with running accumulation', async () => {
    const client = recordingClient(() =>
      streamFrom([
        { type: 'response.reasoning_summary_part.added', part: { type: 'summary_text' } },
        { type: 'response.reasoning_summary_text.delta', delta: 'Reading ' },
        { type: 'response.reasoning_summary_text.delta', delta: 'the adapter.' },
        { type: 'response.output_text.delta', delta: 'Done.' },
        completed(),
      ]),
    );

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    const { chunks, onChunk } = collect();
    const result = await adapter.callStream([{ role: 'user', content: 'hi' }], [], onChunk);

    expect(chunks.map((c) => c.delta)).toEqual(['Reading ', 'the adapter.']);
    expect(chunks.at(-1).accumulated).toBe('Reading the adapter.');
    // Narration must not contaminate the assistant's actual answer.
    expect(result.responseMessage.content).toBe('Done.');
  });

  it('keeps summary text out of message content even when there is no output_text at all', async () => {
    const client = recordingClient(() =>
      streamFrom([
        { type: 'response.reasoning_summary_part.added' },
        { type: 'response.reasoning_summary_text.delta', delta: 'Thinking hard.' },
        {
          type: 'response.output_item.added',
          item: { type: 'function_call', call_id: 'call_1', name: 'web_search' },
        },
        { type: 'response.function_call_arguments.delta', delta: '{"query":"x"}' },
        completed([
          { id: 'fc_1', type: 'function_call', call_id: 'call_1', name: 'web_search', arguments: '{"query":"x"}', status: 'completed' },
        ]),
      ]),
    );

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    const { chunks, onChunk } = collect();
    const result = await adapter.callStream([{ role: 'user', content: 'hi' }], [], onChunk);

    expect(chunks.map((c) => c.delta)).toEqual(['Thinking hard.']);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].function.name).toBe('web_search');
    expect(result.responseMessage.content ?? '').not.toContain('Thinking hard.');
  });

  it('separates consecutive summary parts so they do not render as one paragraph', async () => {
    const client = recordingClient(() =>
      streamFrom([
        { type: 'response.reasoning_summary_part.added' },
        { type: 'response.reasoning_summary_text.delta', delta: 'First part.' },
        { type: 'response.reasoning_summary_text.done', text: 'First part.' },
        { type: 'response.reasoning_summary_part.added' },
        { type: 'response.reasoning_summary_text.delta', delta: 'Second part.' },
        completed(),
      ]),
    );

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    const { chunks, onChunk } = collect();
    await adapter.callStream([{ role: 'user', content: 'hi' }], [], onChunk);

    expect(chunks.at(-1).accumulated).toBe('First part.\n\nSecond part.');
  });

  it('does not duplicate text when .done repeats what the deltas already streamed', async () => {
    const client = recordingClient(() =>
      streamFrom([
        { type: 'response.reasoning_summary_part.added' },
        { type: 'response.reasoning_summary_text.delta', delta: 'Alpha ' },
        { type: 'response.reasoning_summary_text.delta', delta: 'Beta' },
        { type: 'response.reasoning_summary_text.done', text: 'Alpha Beta' },
        completed(),
      ]),
    );

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    const { chunks, onChunk } = collect();
    await adapter.callStream([{ role: 'user', content: 'hi' }], [], onChunk);

    expect(chunks.at(-1).accumulated).toBe('Alpha Beta');
  });

  it('backfills from .done for backends that emit only the terminal event', async () => {
    const client = recordingClient(() =>
      streamFrom([
        { type: 'response.reasoning_summary_part.added' },
        { type: 'response.reasoning_summary_text.done', text: 'Whole summary at once.' },
        completed(),
      ]),
    );

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    const { chunks, onChunk } = collect();
    await adapter.callStream([{ role: 'user', content: 'hi' }], [], onChunk);

    expect(chunks.map((c) => c.delta)).toEqual(['Whole summary at once.']);
  });

  it('ignores a .done payload that is not a clean extension rather than duplicating the part', async () => {
    const client = recordingClient(() =>
      streamFrom([
        { type: 'response.reasoning_summary_part.added' },
        { type: 'response.reasoning_summary_text.delta', delta: 'Streamed text.' },
        { type: 'response.reasoning_summary_text.done', text: 'Completely different text.' },
        completed(),
      ]),
    );

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    const { chunks, onChunk } = collect();
    await adapter.callStream([{ role: 'user', content: 'hi' }], [], onChunk);

    expect(chunks.at(-1).accumulated).toBe('Streamed text.');
  });

  it('still requests reasoning.summary from the Codex backend', async () => {
    const client = recordingClient(() => streamFrom([completed()]));
    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    await adapter.callStream([{ role: 'user', content: 'hi' }], [], () => {});

    expect(client.calls[0].reasoning).toMatchObject({ summary: 'auto' });
    expect(client.calls[0].reasoning.effort).toBeTruthy();
    expect(client.calls[0].text).toEqual({ verbosity: 'low' });
  });

  it('accumulates summaries safely on the non-streaming path (no onChunk)', async () => {
    const client = recordingClient(() =>
      streamFrom([
        { type: 'response.reasoning_summary_part.added' },
        { type: 'response.reasoning_summary_text.delta', delta: 'Quiet thinking.' },
        { type: 'response.output_text.delta', delta: 'Answer.' },
        completed(),
      ]),
    );

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    const result = await adapter.call([{ role: 'user', content: 'hi' }], []);

    expect(result.responseMessage.content).toBe('Answer.');
  });
});

describe('reasoning summary streaming (OpenAI Responses)', () => {
  it('requests reasoning.summary and streams the deltas it receives', async () => {
    const client = recordingClient(() =>
      streamFrom([
        { type: 'response.reasoning_summary_part.added' },
        { type: 'response.reasoning_summary_text.delta', delta: 'Planning the fix.' },
        { type: 'response.output_text.delta', delta: 'Here it is.' },
        completed(),
      ]),
    );

    const adapter = await createLlmAdapter('openai', client, 'gpt-5');
    const { chunks, onChunk } = collect();
    const result = await adapter.callStream([{ role: 'user', content: 'hi' }], [], onChunk);

    expect(client.calls[0].reasoning).toMatchObject({ summary: 'auto' });
    expect(client.calls[0].text).toEqual({ verbosity: 'low' });
    expect(chunks.map((c) => c.delta)).toEqual(['Planning the fix.']);
    expect(result.responseMessage.content).toBe('Here it is.');
  });
});

describe('GPT-5 text verbosity defaults', () => {
  it('does not send text.verbosity to non-GPT-5 Responses models', async () => {
    const client = recordingClient(() => streamFrom([completed()]));
    const adapter = await createLlmAdapter('openai', client, 'o3');
    await adapter.callStream([{ role: 'user', content: 'hi' }], [], () => {});

    expect(client.calls[0]).not.toHaveProperty('text');
  });
});

describe('reasoning summary capability fallback', () => {
  function summaryRejection() {
    const error = new Error("Invalid value for 'reasoning.summary': not supported for this model.");
    error.status = 400;
    return error;
  }

  it('drops summary and self-heals when the provider rejects the field', async () => {
    const client = recordingClient((callNumber) => {
      if (callNumber === 1) throw summaryRejection();
      return streamFrom([{ type: 'response.output_text.delta', delta: 'ok' }, completed()]);
    });

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    const result = await adapter.callStream([{ role: 'user', content: 'hi' }], [], () => {});

    expect(client.calls).toHaveLength(2);
    expect(client.calls[0].reasoning).toHaveProperty('summary', 'auto');
    expect(client.calls[1].reasoning).not.toHaveProperty('summary');
    // Still has a valid effort — we dropped only the summary field.
    expect(client.calls[1].reasoning.effort).toBeTruthy();
    expect(result.responseMessage.content).toBe('ok');
    expect(result.recoveredFromError).toBeUndefined();
  });

  it('stays disabled for subsequent calls on the same adapter instance', async () => {
    const client = recordingClient((callNumber) => {
      if (callNumber === 1) throw summaryRejection();
      return streamFrom([{ type: 'response.output_text.delta', delta: 'ok' }, completed()]);
    });

    const adapter = await createLlmAdapter('openai-codex', client, 'gpt-5.5');
    await adapter.callStream([{ role: 'user', content: 'hi' }], [], () => {});
    await adapter.callStream([{ role: 'user', content: 'again' }], [], () => {});

    expect(client.calls).toHaveLength(3);
    expect(client.calls[2].reasoning).not.toHaveProperty('summary');
  });

  it('does not misread an unrelated 400 as a summary rejection', async () => {
    const adapter = await createLlmAdapter('openai-codex', recordingClient(() => streamFrom([])), 'gpt-5.5');

    const unrelated = new Error("Invalid value for 'temperature': must be <= 2.");
    unrelated.status = 400;
    expect(adapter._isReasoningSummaryUnsupportedError(unrelated)).toBe(false);

    // Mentions summaries but is not a capability rejection.
    const contentComplaint = new Error('The reasoning summary was truncated.');
    contentComplaint.status = 400;
    expect(adapter._isReasoningSummaryUnsupportedError(contentComplaint)).toBe(false);

    // Right wording, wrong status class — a 500 is a transient backend issue.
    const serverError = new Error('summary is not supported');
    serverError.status = 500;
    expect(adapter._isReasoningSummaryUnsupportedError(serverError)).toBe(false);
  });

  it('reads the rejection out of a nested SDK error body', async () => {
    const adapter = await createLlmAdapter('openai-codex', recordingClient(() => streamFrom([])), 'gpt-5.5');

    const nested = new Error('400 Bad Request');
    nested.status = 400;
    nested.error = { message: 'Unknown parameter: reasoning.summary.', param: 'reasoning.summary' };
    expect(adapter._isReasoningSummaryUnsupportedError(nested)).toBe(true);
  });

  it('never re-fires the fallback once disabled, so it cannot loop', async () => {
    const adapter = await createLlmAdapter('openai-codex', recordingClient(() => streamFrom([])), 'gpt-5.5');
    const error = summaryRejection();

    expect(adapter._isReasoningSummaryUnsupportedError(error)).toBe(true);
    adapter._reasoningSummaryDisabled = true;
    expect(adapter._isReasoningSummaryUnsupportedError(error)).toBe(false);
  });
});
