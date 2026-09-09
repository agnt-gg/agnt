/**
 * POST /orchestrator/compress, end to end against the isolated test database
 * with only the provider mocked.
 *
 * What a pure-module test cannot reach: that the spend lands in BOTH ledgers
 * (agent_executions for Traces and the panel, llm_calls for cross-path
 * totals) from the same usage object, that the eviction watermark is reset,
 * and that a provider failure records a failed run rather than a silent 500.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const adapterCall = vi.fn();
vi.mock('../ai/LlmService.js', () => ({ createLlmClient: vi.fn(async () => ({})) }));
vi.mock('./llmAdapters.js', () => ({ createLlmAdapter: vi.fn(async () => ({ call: adapterCall })) }));

import db, { dbReady } from '../../models/database/index.js';
import conversationManager from '../ConversationManager.js';
import { handleCompaction } from './compactionHandler.js';

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (err) { return err ? reject(err) : resolve(this); }));

const USER = 'user-compaction-handler';

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  return res;
}

const history = [
  { role: 'user', content: 'Read config.json and tell me the port' },
  { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"config.json"}' } }] },
  { role: 'tool', tool_call_id: 'c1', content: '{"port":3333}' },
  { role: 'assistant', content: 'The port is 3333.' },
];

beforeAll(async () => {
  await dbReady;
  await dbRun(`INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)`, [USER, `${USER}@test.local`, USER]);
});

beforeEach(() => {
  adapterCall.mockReset();
});

describe('handleCompaction', () => {
  it('rejects unauthenticated and malformed requests before touching a provider', async () => {
    let res = mockRes();
    await handleCompaction({ user: null, body: { messages: history, provider: 'anthropic', model: 'm' } }, res);
    expect(res.statusCode).toBe(401);

    res = mockRes();
    await handleCompaction({ user: { id: USER }, body: { messages: [], provider: 'anthropic', model: 'm' } }, res);
    expect(res.statusCode).toBe(400);

    res = mockRes();
    await handleCompaction({ user: { id: USER }, body: { messages: history, provider: 'anthropic' } }, res);
    expect(res.statusCode).toBe(400);
    expect(adapterCall).not.toHaveBeenCalled();
  });

  it('distils, prices, records the run in both ledgers, and resets the eviction watermark', async () => {
    const conversationId = `conv-compaction-${Date.now()}`;
    conversationManager.store(conversationId, { messages: [], _evictedUnits: 7 });

    adapterCall.mockResolvedValueOnce({
      responseMessage: { content: [{ type: 'text', text: '## Goal\nPort is 3333 (config.json).' }] },
      usage: { input_tokens: 1200, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });

    const res = mockRes();
    await handleCompaction({
      user: { id: USER },
      body: { conversationId, messages: history, provider: 'Anthropic', model: 'claude-sonnet-4-5-20250929' },
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.summary).toBe('## Goal\nPort is 3333 (config.json).');
    expect(res.body.provider).toBe('anthropic');
    expect(res.body.tokenUsage).toMatchObject({ inputTokens: 1200, outputTokens: 60, totalTokens: 1260 });
    expect(res.body.estimatedCost).toBeGreaterThan(0);
    expect(res.body.calls).toBe(1);

    // The provider saw a transcript, not a system prompt, and no tools.
    const [llmMessages, tools] = adapterCall.mock.calls[0];
    expect(tools).toEqual([]);
    expect(llmMessages.map((m) => m.role)).toEqual(['user']);
    expect(llmMessages[0].content).toContain('read_file({"path":"config.json"})');

    // agent_executions: the row the panel and Traces read.
    const exec = await dbGet('SELECT * FROM agent_executions WHERE id = ?', [res.body.executionId]);
    expect(exec.origin).toBe('compaction');
    expect(exec.status).toBe('completed');
    expect(exec.conversation_id).toBe(conversationId);
    expect(exec.input_tokens).toBe(1200);
    expect(exec.output_tokens).toBe(60);
    expect(exec.estimated_cost).toBeCloseTo(res.body.estimatedCost, 10);

    // llm_calls: the same spend, same numbers.
    const ledger = await dbGet('SELECT * FROM llm_calls WHERE execution_id = ?', [res.body.executionId]);
    expect(ledger.origin).toBe('compaction');
    expect(ledger.input_tokens).toBe(1200);
    expect(ledger.output_tokens).toBe(60);
    expect(ledger.cost_usd).toBeCloseTo(exec.estimated_cost, 10);

    // The chunked-eviction watermark is forgotten for the compressed history.
    expect(conversationManager.get(conversationId)._evictedUnits).toBe(0);
    conversationManager.delete(conversationId);
  });

  it('a provider failure is a 502 with the reason, and the run is recorded as failed', async () => {
    adapterCall.mockResolvedValueOnce({ responseMessage: null, recoveredFromError: true, recoveredError: 'rate limited' });

    const res = mockRes();
    await handleCompaction({
      user: { id: USER },
      body: { conversationId: 'conv-x', messages: history, provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
    }, res);

    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ success: false, error: 'rate limited' });

    const exec = await dbGet(
      `SELECT status, error FROM agent_executions WHERE user_id = ? AND origin = 'compaction' ORDER BY start_time DESC LIMIT 1`,
      [USER],
    );
    expect(exec.status).toBe('failed');
    expect(exec.error).toBe('rate limited');
  });
});
