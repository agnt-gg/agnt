// The agent-execution detail mapper must not drop fields the backend sends.
//
// This mapper was a hand-written whitelist. It named ~12 keys and silently
// discarded everything else — including `estimatedCost` and the token counts,
// which the SUMMARY mapper in the same file does copy. The visible symptom was
// specific and confusing: an orchestrator run showed "Cost: $16.77" on its card
// in the runs list, and then showed no cost at all the moment you clicked it,
// because the detail object replaced the summary one and had no such field.
//
// PRD-122 then added `ledger` and `tree` to the backend response and they
// vanished the same way, which is what makes this a CLASS of defect rather than
// one missing line. A whitelist in the client says the client is the authority
// on what a run detail contains; it is not.
//
// These tests pin the contract: unknown fields pass through, known overrides
// still win.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import executionHistory from './executionHistory.js';

vi.mock('axios');

const AGENT_UUID = 'a77f4bc4-b24f-4c84-bf71-bc62ec970483';
const EXEC_ID = `agent-${AGENT_UUID}`;

// Shaped like the real /executions/agents/:id response.
const agentDetailResponse = (over = {}) => ({
  id: AGENT_UUID,
  agentId: null,
  agentName: 'Orchestrator',
  status: 'completed',
  startTime: '2026-08-01T16:31:56.326Z',
  endTime: '2026-08-01T16:44:18.000Z',
  creditsUsed: 742,
  toolCallsCount: 3,
  initialPrompt: 'do the thing',
  finalResponse: 'done',
  provider: 'Claude-Code',
  model: 'claude-opus-5',
  inputTokens: 21_436_772,
  outputTokens: 47_594,
  totalTokens: 21_484_366,
  estimatedCost: 16.7705625,
  cacheReadTokens: 20_924_905,
  cacheCreationTokens: 511_785,
  toolExecutions: [
    { id: 't1', toolName: 'read_file', toolCallId: 'call_1', status: 'completed', creditsUsed: 2 },
  ],
  ledger: {
    costUsd: 0,
    notionalUsd: 16.7705625,
    savedUsd: 0,
    notionalSavedUsd: 91.6031475,
    unpricedCalls: 0,
    calls: 1,
    cacheReadTokens: 20_924_905,
  },
  tree: null,
  ...over,
});

let commit;
let state;

const run = (id = EXEC_ID) =>
  executionHistory.actions.fetchExecutionDetails({ commit, state }, id);

beforeEach(() => {
  commit = vi.fn();
  // A fresh cache each test — a hit would short-circuit the mapper entirely and
  // make these assertions vacuous.
  state = { detailedExecutionsCache: new Map() };
  vi.clearAllMocks();
  localStorage.setItem('token', 'test-token');
});

describe('cost and token fields survive the mapping', () => {
  it('keeps estimatedCost, which the panel needs to render a cost at all', async () => {
    axios.get.mockResolvedValue({ data: agentDetailResponse() });
    const result = await run();
    expect(result.estimatedCost).toBe(16.7705625);
  });

  it('keeps the token counts', async () => {
    axios.get.mockResolvedValue({ data: agentDetailResponse() });
    const result = await run();
    expect(result.totalTokens).toBe(21_484_366);
    expect(result.inputTokens).toBe(21_436_772);
    expect(result.outputTokens).toBe(47_594);
    expect(result.cacheReadTokens).toBe(20_924_905);
  });

  it('keeps the ledger, which is the only source that knows charged vs seat usage', async () => {
    axios.get.mockResolvedValue({ data: agentDetailResponse() });
    const result = await run();
    expect(result.ledger).toBeTruthy();
    expect(result.ledger.notionalUsd).toBe(16.7705625);
    expect(result.ledger.calls).toBe(1);
  });

  it('keeps the run tree when the backend supplies one', async () => {
    const tree = {
      rootExecutionId: AGENT_UUID,
      nodes: [{ id: AGENT_UUID, parentExecutionId: null, agentName: 'Orchestrator', origin: 'chat', ledger: null }],
      unattached: [],
      subtree: { costUsd: 0, notionalUsd: 1, calls: 1, unpricedCalls: 0 },
    };
    axios.get.mockResolvedValue({ data: agentDetailResponse({ tree }) });
    const result = await run();
    expect(result.tree).toEqual(tree);
  });
});

describe('the mapper is not a whitelist', () => {
  it('passes through a field it has never heard of', async () => {
    // THE point of this file. Every assertion above names a field that exists
    // today; this one is about the next field somebody adds to the backend.
    // Without it, the tests above would keep passing while the mapper quietly
    // reverted to dropping anything unnamed.
    axios.get.mockResolvedValue({
      data: agentDetailResponse({ someFutureField: { deep: 'value' } }),
    });
    const result = await run();
    expect(result.someFutureField).toEqual({ deep: 'value' });
  });
});

describe('explicit overrides still win', () => {
  it('keeps the prefixed id the runs list uses, not the raw backend uuid', async () => {
    // The list keys agent rows as `agent-<uuid>` so they cannot collide with
    // workflow executions. Spreading the response must not overwrite that with
    // the bare uuid, or selection and cache lookups break.
    axios.get.mockResolvedValue({ data: agentDetailResponse() });
    const result = await run();
    expect(result.id).toBe(EXEC_ID);
    expect(result.agentExecutionId).toBe(AGENT_UUID);
  });

  it('maps tool executions into the nodeExecutions shape the panel renders', async () => {
    axios.get.mockResolvedValue({ data: agentDetailResponse() });
    const result = await run();
    expect(result.nodeExecutions).toHaveLength(1);
    expect(result.nodeExecutions[0].name).toBe('read_file');
    expect(result.nodeExecutions[0].node_id).toBe('call_1');
  });

  it('names the run from agentName and flags it as an agent execution', async () => {
    axios.get.mockResolvedValue({ data: agentDetailResponse() });
    const result = await run();
    expect(result.workflowName).toBe('Orchestrator');
    expect(result.type).toBe('agent');
    expect(result.isAgentExecution).toBe(true);
    expect(result.log).toBeNull();
  });

  it('falls back to a readable name when the backend has none', async () => {
    axios.get.mockResolvedValue({ data: agentDetailResponse({ agentName: null }) });
    const result = await run();
    expect(result.workflowName).toBe('Agent Chat');
  });

  it('hits the agent endpoint with the unprefixed id', async () => {
    axios.get.mockResolvedValue({ data: agentDetailResponse() });
    await run();
    expect(axios.get.mock.calls[0][0]).toContain(`/executions/agents/${AGENT_UUID}`);
    expect(axios.get.mock.calls[0][0]).not.toContain('agent-agent-');
  });
});

describe('caching', () => {
  it('serves a cached detail without re-fetching', async () => {
    const cached = { id: EXEC_ID, ledger: { calls: 7 } };
    state.detailedExecutionsCache.set(EXEC_ID, { data: cached, timestamp: Date.now() });
    const result = await run();
    expect(result).toBe(cached);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('re-fetches once the entry is older than the TTL', async () => {
    state.detailedExecutionsCache.set(EXEC_ID, {
      data: { id: EXEC_ID, stale: true },
      timestamp: Date.now() - 400_000,
    });
    axios.get.mockResolvedValue({ data: agentDetailResponse() });
    const result = await run();
    expect(axios.get).toHaveBeenCalled();
    expect(result.stale).toBeUndefined();
    expect(result.ledger).toBeTruthy();
  });
});
