// unfirehose/1.0 Native JSONL Session Logger — unit, integration, functional tests
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSession, wrapSendEvent, isEnabled } from './UnfirehoseLogger.js';
import { readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// Use a temp dir for all tests to avoid polluting ~/.agnt
const TEST_DIR = join(tmpdir(), `unfirehose-test-${Date.now()}`);

beforeEach(() => {
  process.env.UNFIREHOSE_DIR = TEST_DIR;
  delete process.env.UNFIREHOSE_DISABLED;
});

afterEach(() => {
  try { rmSync(TEST_DIR, { recursive: true, force: true }); } catch { /* ok */ }
  delete process.env.UNFIREHOSE_DIR;
  delete process.env.UNFIREHOSE_DISABLED;
});

function readSessionLines(session) {
  const content = readFileSync(session.outputFile, 'utf-8');
  return content.trim().split('\n').map(line => JSON.parse(line));
}
// === UNIT TESTS ===
describe('Unit: isEnabled', () => {
  it('returns true by default', () => {
    expect(isEnabled()).toBe(true);
  });

  it('returns false when UNFIREHOSE_DISABLED=1', () => {
    process.env.UNFIREHOSE_DISABLED = '1';
    expect(isEnabled()).toBe(false);
  });

  it('returns true for other UNFIREHOSE_DISABLED values', () => {
    process.env.UNFIREHOSE_DISABLED = 'false';
    expect(isEnabled()).toBe(true);
  });
});

describe('Unit: encodeProjectSlug', () => {
  it('encodes a session with a cwd path as a slug', () => {
    const session = createSession({ cwd: '/home/user/project' });
    expect(session.projectSlug).toBe('-home-user-project');
  });

  it('defaults to process.cwd() slug when no cwd given', () => {
    const session = createSession({});
    expect(session.projectSlug).toBeTruthy();
    expect(session.projectSlug).not.toContain('/');
  });
  it('uses explicit projectSlug when provided', () => {
    const session = createSession({ projectSlug: 'my-project' });
    expect(session.projectSlug).toBe('my-project');
  });

  it('handles dotfiles in paths', () => {
    const session = createSession({ cwd: '/home/user/.config/agnt' });
    expect(session.projectSlug).toBe('-home-user--config-agnt');
  });
}); describe('Unit: _extractUsage', () => {
  it('extracts OpenAI-style usage (prompt_tokens/completion_tokens)', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const usage = session._extractUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
    });
    expect(usage).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
    });
  });

  it('extracts unfirehose-style usage (inputTokens/outputTokens)', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const usage = session._extractUsage({
      inputTokens: 200,
      outputTokens: 75,
    });
    expect(usage).toEqual({
      inputTokens: 200,
      outputTokens: 75,
      totalTokens: 275,
    });
  });

  it('extracts Anthropic cache tokens', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const usage = session._extractUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      cache_read_input_tokens: 80,
      cache_creation_input_tokens: 20,
    });
    expect(usage.inputTokenDetails).toEqual({
      cacheReadTokens: 80,
      cacheWriteTokens: 20,
    });
  });

  it('returns undefined for null usage', () => {
    const session = createSession({ cwd: '/tmp/test' });
    expect(session._extractUsage(null)).toBeUndefined();
    expect(session._extractUsage(undefined)).toBeUndefined();
  });

  it('accumulates totalUsage across multiple calls', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session._extractUsage({ prompt_tokens: 100, completion_tokens: 50 });
    session._extractUsage({ prompt_tokens: 200, completion_tokens: 100 });
    expect(session.totalUsage).toEqual({
      inputTokens: 300,
      outputTokens: 150,
      totalTokens: 450,
    });
  });
});


// ============================================================================
// INTEGRATION TESTS — session lifecycle, file I/O
// ============================================================================

describe('Integration: session creation', () => {
  it('creates output directory and file', () => {
    const session = createSession({ cwd: '/tmp/test-project' });
    expect(existsSync(session.outputFile)).toBe(true);
  });

  it('writes session envelope as first line', () => {
    const session = createSession({
      cwd: '/tmp/test',
      firstPrompt: 'Hello world',
      provider: 'anthropic',
      model: 'claude-3',
      chatType: 'orchestrator',
    });
    const lines = readSessionLines(session);
    expect(lines.length).toBe(1);

    const envelope = lines[0];
    expect(envelope.$schema).toBe('unfirehose/1.0');
    expect(envelope.type).toBe('session');
    expect(envelope.id).toBe(session.sessionId);
    expect(envelope.status).toBe('active');
    expect(envelope.firstPrompt).toBe('Hello world');
    expect(envelope.harness).toBe('agnt');
    expect(envelope.cwd).toBe('/tmp/test');
    expect(envelope.messageCount).toBe(0);
    expect(envelope.createdAt).toBeTruthy();
  });

  it('uses conversationId as session ID when provided', () => {
    const convId = 'conv-' + randomUUID();
    const session = createSession({ conversationId: convId, cwd: '/tmp/test' });
    expect(session.sessionId).toBe(convId);
  });

  it('generates a UUIDv7-like session ID when no conversationId', () => {
    const session = createSession({ cwd: '/tmp/test' });
    // UUIDv7 format: 8-4-4-4-12, version char should be '7'
    expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('truncates firstPrompt to 500 chars in envelope', () => {
    const longPrompt = 'x'.repeat(1000);
    const session = createSession({ cwd: '/tmp/test', firstPrompt: longPrompt });
    const lines = readSessionLines(session);
    expect(lines[0].firstPrompt.length).toBe(500);
  });
});

describe('Integration: logUserMessage', () => {
  it('logs a text user message', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const msgId = session.logUserMessage('What is 2+2?');
    const lines = readSessionLines(session);

    expect(lines.length).toBe(2); // envelope + message
    const msg = lines[1];
    expect(msg.$schema).toBe('unfirehose/1.0');
    expect(msg.type).toBe('message');
    expect(msg.role).toBe('user');
    expect(msg.id).toBe(msgId);
    expect(msg.content).toEqual([{ type: 'text', text: 'What is 2+2?' }]);
    expect(msg.sessionId).toBe(session.sessionId);
    expect(msg.timestamp).toBeTruthy();
    expect(msg.harness).toBe('agnt');
  });

  it('logs multi-part content (vision)', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logUserMessage([
      { type: 'text', text: 'Describe this image' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,abc123' } },
    ]);
    const lines = readSessionLines(session);
    const msg = lines[1];
    expect(msg.content).toHaveLength(2);
    expect(msg.content[0]).toEqual({ type: 'text', text: 'Describe this image' });
    expect(msg.content[1]).toEqual({ type: 'image', mediaType: 'image/png', data: 'data:image/png;base64,abc123' });
  });

  it('coerces non-string/non-array content to string', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logUserMessage(42);
    const lines = readSessionLines(session);
    expect(lines[1].content).toEqual([{ type: 'text', text: '42' }]);
  });
});

describe('Integration: logAssistantMessage', () => {
  it('logs a text assistant message with usage', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logAssistantMessage('The answer is 4.', {
      model: 'claude-sonnet-4-20250514',
      provider: 'anthropic',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      durationMs: 1200,
      stopReason: 'end_turn',
    });
    const lines = readSessionLines(session);
    const msg = lines[1];
    expect(msg.role).toBe('assistant');
    expect(msg.content[0]).toEqual({ type: 'text', text: 'The answer is 4.' });
    expect(msg.model).toBe('claude-sonnet-4-20250514');
    expect(msg.provider).toBe('anthropic');
    expect(msg.stopReason).toBe('end_turn');
    expect(msg.durationMs).toBe(1200);
    expect(msg.usage.inputTokens).toBe(10);
    expect(msg.usage.outputTokens).toBe(5);
  });

  it('logs assistant message with tool calls', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logAssistantMessage('Let me search for that.', {
      toolCalls: [{
        id: 'call_123',
        function: { name: 'web_search', arguments: '{"query":"vitest"}' },
      }],
    });
    const lines = readSessionLines(session);
    const msg = lines[1];
    expect(msg.content).toHaveLength(2);
    expect(msg.content[0]).toEqual({ type: 'text', text: 'Let me search for that.' });
    expect(msg.content[1]).toEqual({
      type: 'tool-call',
      toolCallId: 'call_123',
      toolName: 'web_search',
      input: { query: 'vitest' },
    });
  });

  it('maps provider names correctly', () => {
    const cases = [
      ['anthropic', 'anthropic'],
      ['openai', 'openai'],
      ['google', 'google'],
      ['Claude', 'anthropic'],
      ['gpt-4', 'openai'],
      ['gemini-pro', 'google'],
      ['lmstudio', 'local'],
      ['ollama', 'local'],
    ];
    for (const [input, expected] of cases) {
      const session = createSession({ cwd: '/tmp/test' });
      session.logAssistantMessage('test', { provider: input });
      const lines = readSessionLines(session);
      expect(lines[1].provider).toBe(expected);
    }
  });

  it('maps stop reasons correctly', () => {
    const cases = [
      ['stop', 'end_turn'],
      ['end_turn', 'end_turn'],
      ['tool_calls', 'tool_calls'],
      ['tool_use', 'tool_calls'],
      ['length', 'length'],
      ['max_tokens', 'length'],
      ['content_filter', 'content_filter'],
      ['unknown_reason', undefined],
    ];
    for (const [input, expected] of cases) {
      const session = createSession({ cwd: '/tmp/test' });
      session.logAssistantMessage('test', { stopReason: input });
      const lines = readSessionLines(session);
      expect(lines[1].stopReason).toBe(expected);
    }
  });
});

describe('Integration: logToolResult', () => {
  it('logs a tool result', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logToolResult('call_123', 'web_search', 'Found 10 results');
    const lines = readSessionLines(session);
    const msg = lines[1];
    expect(msg.role).toBe('tool');
    expect(msg.content[0]).toEqual({
      type: 'tool-result',
      toolCallId: 'call_123',
      toolName: 'web_search',
      output: 'Found 10 results',
      isError: false,
    });
  });

  it('logs error tool results', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logToolResult('call_456', 'code_exec', 'TypeError: x is not defined', { isError: true });
    const lines = readSessionLines(session);
    expect(lines[1].content[0].isError).toBe(true);
  });

  it('truncates output over 50KB', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const bigOutput = 'x'.repeat(60000);
    session.logToolResult('call_789', 'read_file', bigOutput);
    const lines = readSessionLines(session);
    const output = lines[1].content[0].output;
    expect(output.length).toBeLessThan(51000);
    expect(output).toContain('[truncated]');
  });

  it('serializes object output to JSON', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logToolResult('call_abc', 'api_call', { status: 200, data: [1, 2, 3] });
    const lines = readSessionLines(session);
    expect(lines[1].content[0].output).toBe('{"status":200,"data":[1,2,3]}');
  });
});

describe('Integration: logSystemMessage', () => {
  it('logs a system message', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logSystemMessage('You are a helpful assistant.');
    const lines = readSessionLines(session);
    const msg = lines[1];
    expect(msg.role).toBe('system');
    expect(msg.content).toEqual([{ type: 'text', text: 'You are a helpful assistant.' }]);
  });
});

describe('Integration: logGoalEvaluation', () => {
  it('writes a run.eval training event', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logGoalEvaluation('goal-42', 0.85, 'Good work on the deliverables');
    const lines = readSessionLines(session);
    const evt = lines[1];
    expect(evt.$schema).toBe('unfirehose/1.0');
    expect(evt.type).toBe('run.eval');
    expect(evt.run_id).toBe('goal-goal-42');
    expect(evt.score).toBe(0.85);
    expect(evt.eval).toBe('Good work on the deliverables');
    expect(evt.ts).toBeTruthy();
  });
});

describe('Integration: logTrainingEvent', () => {
  it('writes arbitrary training events with schema tag', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logTrainingEvent({
      type: 'run.step',
      run_id: 'run-1',
      step: 3,
      action: 'tool_call',
      ts: '2026-03-10T00:00:00Z',
    });
    const lines = readSessionLines(session);
    const evt = lines[1];
    expect(evt.$schema).toBe('unfirehose/1.0');
    expect(evt.type).toBe('run.step');
    expect(evt.step).toBe(3);
  });
});

describe('Integration: session close', () => {
  it('writes session close envelope with aggregate usage', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logUserMessage('Hello');
    session.logAssistantMessage('Hi!', {
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });
    session.logAssistantMessage('More text', {
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    });
    session.close({ summary: 'Test conversation' });

    const lines = readSessionLines(session);
    const closeEnvelope = lines[lines.length - 1];
    expect(closeEnvelope.type).toBe('session');
    expect(closeEnvelope.status).toBe('closed');
    expect(closeEnvelope.messageCount).toBe(3);
    expect(closeEnvelope.totalUsage.inputTokens).toBe(30);
    expect(closeEnvelope.totalUsage.outputTokens).toBe(15);
    expect(closeEnvelope.totalUsage.totalTokens).toBe(45);
    expect(closeEnvelope.summary).toBe('Test conversation');
    expect(closeEnvelope.closedAt).toBeTruthy();
  });
});

describe('Integration: message chaining (parentId)', () => {
  it('chains messages via parentId', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const id1 = session.logUserMessage('First');
    const id2 = session.logAssistantMessage('Second');
    const id3 = session.logUserMessage('Third');

    const lines = readSessionLines(session);
    // First message's parentId is null (no prior message)
    expect(lines[1].parentId).toBeNull();
    // Second message's parentId is first message's id
    expect(lines[2].parentId).toBe(id1);
    // Third message's parentId is second message's id
    expect(lines[3].parentId).toBe(id2);
  });
});

describe('Integration: message ID format', () => {
  it('generates sequential message IDs', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const id1 = session.logUserMessage('One');
    const id2 = session.logAssistantMessage('Two');
    const id3 = session.logUserMessage('Three');

    expect(id1).toBe(`${session.sessionId}-0001`);
    expect(id2).toBe(`${session.sessionId}-0002`);
    expect(id3).toBe(`${session.sessionId}-0003`);
  });
});


// ============================================================================
// FUNCTIONAL TESTS — full conversation flow, wrapSendEvent, schema compliance
// ============================================================================

describe('Functional: full conversation lifecycle', () => {
  it('logs a complete chat session with user → assistant → tool → assistant → close', () => {
    const session = createSession({
      cwd: '/home/user/project',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      chatType: 'orchestrator',
      firstPrompt: 'Search for vitest docs',
    });

    // User message
    session.logUserMessage('Search for vitest docs');

    // Assistant with tool call
    session.logAssistantMessage('I\'ll search for that.', {
      toolCalls: [{
        id: 'tc_1',
        function: { name: 'web_search', arguments: '{"q":"vitest documentation"}' },
      }],
      stopReason: 'tool_calls',
      usage: { prompt_tokens: 50, completion_tokens: 20 },
      durationMs: 800,
    });

    // Tool result
    session.logToolResult('tc_1', 'web_search', 'Vitest is a blazing fast unit test framework.');

    // Final assistant response
    session.logAssistantMessage('Vitest is a fast unit testing framework for Vite projects.', {
      stopReason: 'end_turn',
      usage: { prompt_tokens: 100, completion_tokens: 30 },
      durationMs: 1500,
    });

    // Close
    session.close({ summary: 'Searched for vitest docs' });

    const lines = readSessionLines(session);
    expect(lines.length).toBe(6); // envelope + 4 messages + close

    // Validate all lines have $schema
    for (const line of lines) {
      expect(line.$schema).toBe('unfirehose/1.0');
    }

    // Validate roles in order
    expect(lines[0].type).toBe('session');
    expect(lines[1].role).toBe('user');
    expect(lines[2].role).toBe('assistant');
    expect(lines[3].role).toBe('tool');
    expect(lines[4].role).toBe('assistant');
    expect(lines[5].type).toBe('session');

    // Validate the tool-call block
    const toolCallBlock = lines[2].content.find(b => b.type === 'tool-call');
    expect(toolCallBlock.toolCallId).toBe('tc_1');
    expect(toolCallBlock.toolName).toBe('web_search');
    expect(toolCallBlock.input).toEqual({ q: 'vitest documentation' });

    // Validate close envelope
    expect(lines[5].status).toBe('closed');
    expect(lines[5].messageCount).toBe(4);
    expect(lines[5].totalUsage.inputTokens).toBe(150);
    expect(lines[5].totalUsage.outputTokens).toBe(50);
  });
});

describe('Functional: wrapSendEvent SSE interception', () => {
  it('intercepts SSE events and logs messages without disrupting original flow', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const forwarded = [];
    const originalSendEvent = (name, data) => forwarded.push({ name, data });

    const wrappedSend = wrapSendEvent(session, originalSendEvent);

    // Simulate SSE event flow for a simple text response
    wrappedSend('assistant_message', {});
    wrappedSend('content_delta', { delta: 'Hello' });
    wrappedSend('content_delta', { delta: ' world' });
    wrappedSend('final_content', { content: 'Hello world' });

    // All events should have been forwarded
    expect(forwarded.length).toBe(4);
    expect(forwarded.map(f => f.name)).toEqual([
      'assistant_message', 'content_delta', 'content_delta', 'final_content',
    ]);

    // Should have logged the assistant message
    const lines = readSessionLines(session);
    const assistantMsgs = lines.filter(l => l.role === 'assistant');
    expect(assistantMsgs.length).toBe(1);
    expect(assistantMsgs[0].content[0].text).toBe('Hello world');
  });

  it('intercepts tool_start/tool_end and logs tool calls with results', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const wrappedSend = wrapSendEvent(session, () => {});

    // Simulate: assistant decides to use a tool
    wrappedSend('assistant_message', {});
    wrappedSend('content_delta', { delta: 'Let me check.' });
    wrappedSend('tool_start', {
      toolCall: { id: 'tc_99', name: 'calculator', args: { expr: '2+2' } },
    });
    wrappedSend('tool_end', {
      toolCall: { id: 'tc_99', name: 'calculator', result: '4' },
    });
    wrappedSend('tool_executions', {});

    const lines = readSessionLines(session);
    // Should have: envelope, tool result, assistant message (from tool_executions)
    const toolMsgs = lines.filter(l => l.role === 'tool');
    expect(toolMsgs.length).toBe(1);
    expect(toolMsgs[0].content[0].toolCallId).toBe('tc_99');
    expect(toolMsgs[0].content[0].toolName).toBe('calculator');
    expect(toolMsgs[0].content[0].output).toBe('4');

    const assistantMsgs = lines.filter(l => l.role === 'assistant');
    expect(assistantMsgs.length).toBe(1);
    expect(assistantMsgs[0].content.find(b => b.type === 'tool-call')).toBeTruthy();
  });

  it('intercepts error events and logs system messages', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const wrappedSend = wrapSendEvent(session, () => {});

    wrappedSend('error', { error: 'Rate limit exceeded' });

    const lines = readSessionLines(session);
    const systemMsgs = lines.filter(l => l.role === 'system');
    expect(systemMsgs.length).toBe(1);
    expect(systemMsgs[0].content[0].text).toContain('Rate limit exceeded');
  });

  it('closes session on done event', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const wrappedSend = wrapSendEvent(session, () => {});

    wrappedSend('assistant_message', {});
    wrappedSend('content_delta', { accumulated: 'Final answer' });
    wrappedSend('final_content', { content: 'Final answer' });
    wrappedSend('done', {});

    const lines = readSessionLines(session);
    const lastLine = lines[lines.length - 1];
    expect(lastLine.type).toBe('session');
    expect(lastLine.status).toBe('closed');
  });

  it('handles accumulated content_delta format', () => {
    const session = createSession({ cwd: '/tmp/test' });
    const wrappedSend = wrapSendEvent(session, () => {});

    wrappedSend('assistant_message', {});
    wrappedSend('content_delta', { accumulated: 'Full text' });
    wrappedSend('final_content', {});

    const lines = readSessionLines(session);
    const assistantMsgs = lines.filter(l => l.role === 'assistant');
    expect(assistantMsgs[0].content[0].text).toBe('Full text');
  });
});

describe('Functional: unfirehose/1.0 schema compliance', () => {
  it('every line has $schema: "unfirehose/1.0"', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logUserMessage('Hello');
    session.logAssistantMessage('Hi', { usage: { prompt_tokens: 5, completion_tokens: 3 } });
    session.logToolResult('tc1', 'search', 'results');
    session.logSystemMessage('System info');
    session.logGoalEvaluation('g1', 0.9, 'Good');
    session.logTrainingEvent({ type: 'run.step', step: 1, ts: new Date().toISOString() });
    session.close();

    const lines = readSessionLines(session);
    for (const line of lines) {
      expect(line.$schema).toBe('unfirehose/1.0');
    }
  });

  it('message entries have required fields: type, role, id, content, timestamp', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logUserMessage('Test');
    session.logAssistantMessage('Response');

    const lines = readSessionLines(session);
    const messages = lines.filter(l => l.type === 'message');
    expect(messages.length).toBe(2);

    for (const msg of messages) {
      expect(msg.type).toBe('message');
      expect(['user', 'assistant', 'system', 'tool']).toContain(msg.role);
      expect(msg.id).toBeTruthy();
      expect(Array.isArray(msg.content)).toBe(true);
      expect(msg.timestamp).toBeTruthy();
      expect(msg.sessionId).toBe(session.sessionId);
      expect(msg.harness).toBe('agnt');
    }
  });

  it('content blocks use unfirehose/1.0 type names (not Claude Code names)', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logAssistantMessage('Thinking...', {
      toolCalls: [{
        id: 'tc1',
        function: { name: 'bash', arguments: '{"cmd":"ls"}' },
      }],
    });
    session.logToolResult('tc1', 'bash', 'file1.txt\nfile2.txt');

    const lines = readSessionLines(session);
    const assistantMsg = lines.find(l => l.role === 'assistant');
    const toolMsg = lines.find(l => l.role === 'tool');

    // Should use tool-call (not tool_use)
    const toolCallBlock = assistantMsg.content.find(b => b.type === 'tool-call');
    expect(toolCallBlock).toBeTruthy();
    expect(toolCallBlock.toolCallId).toBe('tc1');
    expect(toolCallBlock.toolName).toBe('bash');

    // Should use tool-result (not tool_result)
    const toolResultBlock = toolMsg.content.find(b => b.type === 'tool-result');
    expect(toolResultBlock).toBeTruthy();
    expect(toolResultBlock.toolCallId).toBe('tc1');
  });

  it('usage uses camelCase (not snake_case)', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logAssistantMessage('Answer', {
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
      },
    });

    const lines = readSessionLines(session);
    const msg = lines.find(l => l.role === 'assistant');
    // camelCase, not snake_case
    expect(msg.usage.inputTokens).toBe(100);
    expect(msg.usage.outputTokens).toBe(50);
    expect(msg.usage.inputTokenDetails.cacheReadTokens).toBe(80);
    expect(msg.usage.inputTokenDetails.cacheWriteTokens).toBe(20);
    // Should NOT have snake_case keys
    expect(msg.usage.input_tokens).toBeUndefined();
    expect(msg.usage.output_tokens).toBeUndefined();
  });

  it('session envelope has required fields', () => {
    const session = createSession({
      cwd: '/home/user/project',
      firstPrompt: 'Test',
    });

    const lines = readSessionLines(session);
    const envelope = lines[0];
    expect(envelope.$schema).toBe('unfirehose/1.0');
    expect(envelope.type).toBe('session');
    expect(envelope.id).toBeTruthy();
    expect(envelope.status).toBe('active');
    expect(envelope.harness).toBe('agnt');
    expect(envelope.harnessVersion).toBeTruthy();
    expect(envelope.createdAt).toBeTruthy();
  });

  it('all JSONL lines are valid JSON', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logUserMessage('Msg 1');
    session.logAssistantMessage('Msg 2', {
      toolCalls: [{ id: 'tc1', function: { name: 'test', arguments: '{}' } }],
    });
    session.logToolResult('tc1', 'test', { nested: { data: true } });
    session.close();

    const raw = readFileSync(session.outputFile, 'utf-8');
    const jsonLines = raw.trim().split('\n');
    for (const line of jsonLines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe('Functional: goal evaluation integration', () => {
  it('logs evaluation session with per-task scores', () => {
    const session = createSession({
      cwd: '/tmp/test',
      chatType: 'goal-evaluation',
      firstPrompt: 'Evaluate goal: Build API',
    });

    // Simulate evaluation flow
    session.logGoalEvaluation('goal-1', 0.85, 'API meets requirements');
    session.logTrainingEvent({
      type: 'run.eval',
      run_id: 'goal-goal-1',
      step: 0,
      eval: 'task-auth',
      score: 0.9,
      ts: new Date().toISOString(),
    });
    session.logTrainingEvent({
      type: 'run.eval',
      run_id: 'goal-goal-1',
      step: 1,
      eval: 'task-crud',
      score: 0.8,
      ts: new Date().toISOString(),
    });
    session.close({ summary: 'PASSED (85%)' });

    const lines = readSessionLines(session);
    const evals = lines.filter(l => l.type === 'run.eval');
    expect(evals.length).toBe(3); // overall + 2 tasks
    expect(evals[0].score).toBe(0.85);
    expect(evals[1].eval).toBe('task-auth');
    expect(evals[2].eval).toBe('task-crud');
  });
});
describe('Functional: edge cases', () => {
  it('handles empty content with only tool calls', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logAssistantMessage('', { toolCalls: [{ id: 'tc_e', function: { name: 'bash', arguments: '{"cmd":"ls"}' } }] });
    expect(readSessionLines(session).find(l => l.role === 'assistant').content.find(b => b.type === 'tool-call')).toBeTruthy();
  });
  it('handles malformed JSON arguments', () => {
    const session = createSession({ cwd: '/tmp/test' });
    session.logAssistantMessage('x', { toolCalls: [{ id: 'tc_b', function: { name: 'test', arguments: 'bad' } }] });
    expect(readSessionLines(session).find(l => l.role === 'assistant').content.find(b => b.type === 'tool-call').input).toEqual({});
  });
  it('handles concurrent sessions', () => {
    const s1 = createSession({ cwd: '/tmp/test' }); const s2 = createSession({ cwd: '/tmp/test' });
    s1.logUserMessage('s1'); s2.logUserMessage('s2');
    expect(readSessionLines(s1)[0].id).not.toBe(readSessionLines(s2)[0].id);
  });
});
