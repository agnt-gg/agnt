/**
 * Unit gate for the ledger's single write path (PRD-122).
 *
 * LlmCallModel is faked so this exercises the RECORDER's logic — pricing
 * pass-through, the NULL-vs-zero rule, notional flagging, root derivation and
 * the never-throw contract — without touching sqlite. Pricing itself is NOT
 * mocked: these assertions run against the real getModelCost, so a change to
 * the multiplier table shows up here rather than silently.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows = [];

const failureNotes = [];

vi.mock('../../models/LlmCallModel.js', () => ({
  default: {
    create: vi.fn(async (row) => {
      if (row.__explode) throw new Error('simulated INSERT failure');
      rows.push(row);
      return `row-${rows.length}`;
    }),
    noteWriteFailure: vi.fn(async (source, message) => {
      failureNotes.push({ source, message });
    }),
  },
}));

const { recordLlmCall, normalizeUsage, getLedgerStats, resetLedgerStats, LEDGER_SOURCE } = await import('./LedgerRecorder.js');
const { getModelCost } = await import('../ai/providerConfigs.js');
const LlmCallModel = (await import('../../models/LlmCallModel.js')).default;

// Concrete pairs verified against the live metadata table.
const PRICED = { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' };
const NOTIONAL = { provider: 'claude-code', model: 'claude-sonnet-4-5-20250929' };
const UNPRICED = { provider: 'zzz-not-a-provider', model: 'nope-model' };

const base = { userId: 'u1', origin: 'chat' };

beforeEach(() => {
  rows.length = 0;
  failureNotes.length = 0;
  resetLedgerStats();
  LlmCallModel.create.mockClear();
  LlmCallModel.noteWriteFailure.mockClear();
});

describe('recordLlmCall — pricing', () => {
  it('writes exactly the cost getModelCost computes, cache multipliers included', async () => {
    await recordLlmCall({
      ...base, ...PRICED,
      usage: { inputTokens: 10000, outputTokens: 2000, cacheReadTokens: 8000 },
    });

    const expected = getModelCost(PRICED.provider, PRICED.model, 10000, 2000, {
      cacheReadTokens: 8000, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].costUsd).toBe(expected.totalCost);
    expect(rows[0].costUsd).toBeGreaterThan(0);
  });

  it('derives the uncached baseline by omitting the cache breakdown, so caching shows a saving', async () => {
    await recordLlmCall({
      ...base, ...PRICED,
      usage: { inputTokens: 10000, outputTokens: 2000, cacheReadTokens: 9000 },
    });
    // Anthropic cache reads bill at 0.1x, so the actual must be BELOW baseline.
    expect(rows[0].uncachedCostUsd).toBeGreaterThan(rows[0].costUsd);
  });

  it('prices a 1-hour cache write above a 5-minute one (2.0x vs 1.25x)', async () => {
    await recordLlmCall({ ...base, ...PRICED, usage: { inputTokens: 10000, outputTokens: 0, cacheCreation5mTokens: 10000 } });
    await recordLlmCall({ ...base, ...PRICED, usage: { inputTokens: 10000, outputTokens: 0, cacheCreation1hTokens: 10000 } });
    expect(rows[1].costUsd).toBeGreaterThan(rows[0].costUsd);
  });
});

describe('recordLlmCall — NULL is not zero', () => {
  it('stores NULL cost for a model with no pricing metadata', async () => {
    await recordLlmCall({ ...base, ...UNPRICED, usage: { inputTokens: 500, outputTokens: 100 } });

    expect(rows).toHaveLength(1);
    // The whole point: null, NOT 0. A zero here is indistinguishable from
    // "this call was free", which is the defect that made workflow spend
    // invisible for months.
    expect(rows[0].costUsd).toBeNull();
    expect(rows[0].costUsd).not.toBe(0);
    expect(rows[0].uncachedCostUsd).toBeNull();
  });

  it('ANTI-VACUITY: the same call with a known model does produce a number', async () => {
    // Without this, the assertion above would still pass if recordLlmCall were
    // broken in a way that nulled every cost.
    await recordLlmCall({ ...base, ...PRICED, usage: { inputTokens: 500, outputTokens: 100 } });
    expect(rows[0].costUsd).toBeGreaterThan(0);
  });
});

describe('recordLlmCall — subscription providers', () => {
  it('flags a subscription seat as notional so it never inflates a charged total', async () => {
    await recordLlmCall({ ...base, ...NOTIONAL, usage: { inputTokens: 1000, outputTokens: 200 } });
    expect(rows[0].isNotional).toBe(1);
    // Notional rows still carry a cost — "what this would have cost metered"
    // is useful — but the aggregates bucket it separately.
    expect(rows[0].costUsd).toBeGreaterThan(0);
  });

  it('flags a metered provider as not notional', async () => {
    await recordLlmCall({ ...base, ...PRICED, usage: { inputTokens: 1000, outputTokens: 200 } });
    expect(rows[0].isNotional).toBe(0);
  });
});

describe('normalizeUsage — provider dialects', () => {
  it('accepts Anthropic, OpenAI and AGNT-internal shapes identically', () => {
    const anthropic = normalizeUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 });
    const openai = normalizeUsage({ prompt_tokens: 10, completion_tokens: 5, cache_read_tokens: 3 });
    const internal = normalizeUsage({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 3 });
    expect(anthropic).toEqual(openai);
    expect(openai).toEqual(internal);
    expect(internal.inputTokens).toBe(10);
  });

  it('treats a legacy single-bucket cache write as 5-minute, matching getModelCost', () => {
    expect(normalizeUsage({ inputTokens: 1, cacheCreationTokens: 700 }).cacheCreation5mTokens).toBe(700);
  });

  it('never returns NaN for a missing or malformed usage object', () => {
    for (const u of [undefined, null, {}, { inputTokens: 'x' }]) {
      const n = normalizeUsage(u);
      expect(Number.isFinite(n.inputTokens)).toBe(true);
      expect(Number.isFinite(n.outputTokens)).toBe(true);
    }
  });
});

describe('recordLlmCall — run-tree linkage', () => {
  it('makes a call its own tree root when no parent is supplied', async () => {
    await recordLlmCall({ ...base, ...PRICED, executionId: 'exec-1', usage: { inputTokens: 10, outputTokens: 1 } });
    expect(rows[0].rootExecutionId).toBe('exec-1');
  });

  it('honours an explicit root so a grandchild joins its ancestor tree', async () => {
    await recordLlmCall({
      ...base, ...PRICED, executionId: 'exec-3', parentExecutionId: 'exec-2', rootExecutionId: 'exec-1',
      usage: { inputTokens: 10, outputTokens: 1 },
    });
    expect(rows[0].rootExecutionId).toBe('exec-1');
    expect(rows[0].parentExecutionId).toBe('exec-2');
  });

  it('carries origin and originId through verbatim', async () => {
    await recordLlmCall({ userId: 'u1', origin: 'goal_task', originId: 'goal-9', ...PRICED, usage: { inputTokens: 10, outputTokens: 1 } });
    expect(rows[0].origin).toBe('goal_task');
    expect(rows[0].originId).toBe('goal-9');
  });
});

describe('recordLlmCall — never throws', () => {
  it('swallows a write failure, counts it, and leaves the caller unharmed', async () => {
    LlmCallModel.create.mockRejectedValueOnce(new Error('disk on fire'));

    const result = await recordLlmCall({ ...base, ...PRICED, usage: { inputTokens: 10, outputTokens: 1 } });

    // The user's provider response already succeeded and was already paid for.
    // Failing their work because bookkeeping failed would be strictly worse.
    expect(result).toBeNull();
    expect(getLedgerStats().failed).toBe(1);
    expect(getLedgerStats().lastError).toMatch(/disk on fire/);
  });

  it('counts successes too, so coverage is measurable rather than assumed', async () => {
    await recordLlmCall({ ...base, ...PRICED, usage: { inputTokens: 10, outputTokens: 1 } });
    expect(getLedgerStats().recorded).toBe(1);
    expect(getLedgerStats().failed).toBe(0);
  });
});

describe('the tripwire spans processes', () => {
  it('persists a dropped write so another process can see it', async () => {
    // AGNT runs the workflow engine in a SEPARATE OS process from the HTTP API.
    // A purely in-memory counter is invisible to whichever process answers
    // /api/ledger/summary — a tripwire that cannot trip for the path most
    // likely to break. The failure must therefore reach shared storage.
    LlmCallModel.create.mockRejectedValueOnce(new Error('db locked'));

    await recordLlmCall({ ...base, ...PRICED, usage: { inputTokens: 10, outputTokens: 1 } });

    expect(failureNotes).toHaveLength(1);
    expect(failureNotes[0].source).toBe(LEDGER_SOURCE);
    expect(failureNotes[0].message).toMatch(/db locked/);
  });

  it('does not persist anything when writes succeed', async () => {
    await recordLlmCall({ ...base, ...PRICED, usage: { inputTokens: 10, outputTokens: 1 } });
    expect(failureNotes).toHaveLength(0);
  });

  it('labels in-process stats with their scope so they cannot read as global', async () => {
    const s = getLedgerStats();
    expect(s.scope).toBe(LEDGER_SOURCE);
    expect(s.pid).toBe(process.pid);
  });

  it('identifies the workflow process by the established env convention', async () => {
    // diagnostics/bootstrap.js already keys off IS_WORKFLOW_PROCESS; reusing it
    // rather than inventing a second notion of "which process am I".
    const saved = process.env.IS_WORKFLOW_PROCESS;
    try {
      process.env.IS_WORKFLOW_PROCESS = 'true';
      vi.resetModules();
      const fresh = await import('./LedgerRecorder.js?workflow');
      expect(fresh.LEDGER_SOURCE).toBe('workflow');
    } finally {
      if (saved === undefined) delete process.env.IS_WORKFLOW_PROCESS;
      else process.env.IS_WORKFLOW_PROCESS = saved;
    }
  });

  it('survives a failing health write — bookkeeping about bookkeeping is never fatal', async () => {
    LlmCallModel.create.mockRejectedValueOnce(new Error('primary failure'));
    LlmCallModel.noteWriteFailure.mockRejectedValueOnce(new Error('health write also failed'));

    await expect(
      recordLlmCall({ ...base, ...PRICED, usage: { inputTokens: 10, outputTokens: 1 } })
    ).resolves.toBeNull();

    expect(getLedgerStats().failed).toBe(1);
  });
});

describe('recordLlmCall — what must NOT be recorded', () => {
  it('skips a successful call that reported no tokens (no evidence of spend)', async () => {
    const r = await recordLlmCall({ ...base, ...PRICED, usage: { inputTokens: 0, outputTokens: 0 } });
    expect(r).toBeNull();
    expect(rows).toHaveLength(0);
  });

  it('STILL records a zero-token call when it failed — an error is evidence', async () => {
    await recordLlmCall({ ...base, ...PRICED, usage: {}, status: 'error', error: 'provider 500' });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('error');
  });

  it('skips a call missing the fields that make a row meaningful', async () => {
    expect(await recordLlmCall({ origin: 'chat', ...PRICED, usage: { inputTokens: 5 } })).toBeNull(); // no userId
    expect(await recordLlmCall({ userId: 'u', ...PRICED, usage: { inputTokens: 5 } })).toBeNull();    // no origin
    expect(await recordLlmCall({ ...base, model: 'm', usage: { inputTokens: 5 } })).toBeNull();       // no provider
    expect(rows).toHaveLength(0);
  });
});
