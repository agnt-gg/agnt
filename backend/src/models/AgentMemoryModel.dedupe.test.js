// Write-path dedupe and read-path tiering.
//
// Measured on the live store 2026-07-31: 97,502 rows, 82.5% auto-extracted
// (46,664 workflow_insight + 33,795 pattern), and exactly TWO byte-identical
// duplicates — so the pre-existing exact-match `findDuplicate` could never
// fire. Normalising ids and numbers collapses the 80,459 auto rows to 50,484
// shapes, worst cluster 1,092 copies of "Duplicate timer trigger execution".
// One memory per workflow execution, from a workflow on a timer.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const run = vi.fn((sql, params, cb) => cb && cb.call({ changes: 1, lastID: 1 }, null));
const get = vi.fn((sql, params, cb) => cb(null, null));
const all = vi.fn((sql, params, cb) => cb(null, []));

vi.mock('./database/index.js', () => ({ default: { run: (...a) => run(...a), get: (...a) => get(...a), all: (...a) => all(...a) } }));
vi.mock('../utils/generateUUID.js', () => ({ default: () => 'new-uuid' }));

const { default: AgentMemoryModel } = await import('./AgentMemoryModel.js');

const TIMER_A = '[bottleneck] Duplicate timer trigger execution: fired twice within 43ms (node a3f1c8e2-4b5d-4e6f-8a9b-0c1d2e3f4a5b)';
const TIMER_B = '[bottleneck] Duplicate timer trigger execution: fired twice within 1902ms (node 7d8e9f0a-1b2c-3d4e-5f6a-7b8c9d0e1f2a)';

const insertCalls = () => run.mock.calls.filter(([sql]) => /INSERT INTO agent_memory/.test(sql));
const shapeProbes = () => get.mock.calls.filter(([sql]) => /content_shape = \?/.test(sql));

beforeEach(() => {
  run.mockClear(); get.mockClear(); all.mockClear();
  get.mockImplementation((sql, params, cb) => cb(null, null));
});

describe('auto-extracted memories dedupe by shape', () => {
  it('probes for an existing shape before inserting', async () => {
    await AgentMemoryModel.create({
      agentId: 'orchestrator', userId: 'u1', memoryType: 'workflow_insight', content: TIMER_A,
    });
    expect(shapeProbes()).toHaveLength(1);
    expect(insertCalls()).toHaveLength(1);
  });

  it('does NOT insert when the same shape already exists', async () => {
    get.mockImplementation((sql, params, cb) => {
      if (/content_shape = \?/.test(sql)) return cb(null, { id: 'existing-id' });
      return cb(null, null);
    });
    const id = await AgentMemoryModel.create({
      agentId: 'orchestrator', userId: 'u1', memoryType: 'workflow_insight', content: TIMER_B,
    });
    expect(id).toBe('existing-id');
    expect(insertCalls()).toHaveLength(0);
    // Seen again = more evidence, recorded as an access bump.
    expect(run.mock.calls.some(([sql]) => /access_count = access_count \+ 1/.test(sql))).toBe(true);
  });

  it('probes with the NORMALISED shape, not the raw content', async () => {
    await AgentMemoryModel.create({
      agentId: 'orchestrator', userId: 'u1', memoryType: 'workflow_insight', content: TIMER_A,
    });
    const [, params] = shapeProbes()[0];
    const shape = params[2];
    expect(shape).not.toContain('43ms');
    expect(shape).not.toContain('a3f1c8e2');
    expect(shape).toContain('#');
  });

  it('two rows differing only by ids/numbers probe for the SAME shape', async () => {
    await AgentMemoryModel.create({ agentId: 'orchestrator', userId: 'u1', memoryType: 'pattern', content: TIMER_A });
    await AgentMemoryModel.create({ agentId: 'orchestrator', userId: 'u1', memoryType: 'pattern', content: TIMER_B });
    const [a, b] = shapeProbes();
    expect(a[1][2]).toBe(b[1][2]);
  });

  it('persists the shape on the inserted row so later writes can match it', async () => {
    await AgentMemoryModel.create({ agentId: 'orchestrator', userId: 'u1', memoryType: 'pattern', content: TIMER_A });
    const [sql, params] = insertCalls()[0];
    expect(sql).toContain('content_shape');
    expect(params[params.length - 1]).toBeTruthy();
  });
});

describe('user-set memories are NEVER deduped', () => {
  // Dedupe discards a row. Acceptable for the 1,092nd generated bottleneck
  // report; never acceptable for something the user asked to be remembered,
  // because the shape key is lossy and two distinct facts can share a
  // normalised prefix.
  for (const memoryType of ['fact', 'preference', 'correction', 'context', 'prompt_guidance']) {
    it(`${memoryType} always inserts`, async () => {
      get.mockImplementation((sql, params, cb) => cb(null, { id: 'would-have-matched' }));
      const id = await AgentMemoryModel.create({
        agentId: 'orchestrator', userId: 'u1', memoryType, content: 'Nathan prefers green',
      });
      expect(shapeProbes()).toHaveLength(0);
      expect(insertCalls()).toHaveLength(1);
      expect(id).toBe('new-uuid');
    });
  }

  it('stores NULL shape for user-set rows', async () => {
    await AgentMemoryModel.create({ agentId: 'orchestrator', userId: 'u1', memoryType: 'fact', content: 'x' });
    const [, params] = insertCalls()[0];
    expect(params[params.length - 1]).toBeNull();
  });
});

describe('retrieval does not reorder the store', () => {
  it('incrementAccess leaves updated_at alone', async () => {
    // updated_at is a SORT KEY for relevance retrieval, so bumping it here
    // made reading memory reorder memory — two identical retrievals with no
    // writes in between returned different sets.
    await AgentMemoryModel.incrementAccess('some-id');
    const [sql] = run.mock.calls.at(-1);
    expect(sql).toContain('access_count = access_count + 1');
    expect(sql).not.toContain('updated_at');
  });

  it('orders with a stable final tiebreaker', async () => {
    await AgentMemoryModel.findByAgentId('orchestrator', { limit: 5 });
    expect(all.mock.calls.at(-1)[0]).toMatch(/ORDER BY .*id ASC/);
  });
});

describe('findTiered gives the tool path the quota the prompt path already had', () => {
  it('reserves most of the budget for user-set memories', async () => {
    all.mockImplementation((sql, params, cb) => cb(null, []));
    await AgentMemoryModel.findTiered('orchestrator', { limit: 30 });
    const typeLists = all.mock.calls.map(([, params]) => params.filter((p) => typeof p === 'string'));
    const userCall = typeLists.find((p) => p.includes('fact'));
    const autoCall = typeLists.find((p) => p.includes('workflow_insight'));
    expect(userCall).toBeTruthy();
    expect(autoCall).toBeTruthy();
    // 80/20 — auto-extracted rows outnumber user-set ~5:1 and share the same
    // relevance score, so an even split still drowns the user's own memories.
    const userLimit = all.mock.calls.find(([, p]) => p.includes('fact'))[1].at(-1);
    const autoLimit = all.mock.calls.find(([, p]) => p.includes('workflow_insight'))[1].at(-1);
    expect(userLimit).toBeGreaterThan(autoLimit);
    expect(userLimit + autoLimit).toBe(30);
  });

  it('an explicit memory_type filter bypasses tiering', async () => {
    await AgentMemoryModel.findTiered('orchestrator', { memoryType: 'workflow_insight', limit: 30 });
    expect(all.mock.calls).toHaveLength(1);
  });

  it('the get_agent_memories tool actually calls it', async () => {
    // The tiering can be perfect and still not be wired up. Observed live: the
    // tool returned 26 of 30 rows as duplicate workflow bottleneck reports
    // because it called findByAgentId flat.
    const fs = await import('fs');
    const path = await import('path');
    const { fileURLToPath } = await import('url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(here, '..', 'services', 'orchestrator', 'tools.js'), 'utf8',
    );
    const idx = src.indexOf('get_agent_memories: {');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 2200);
    expect(block).toMatch(/AgentMemoryModel\.findTiered\(/);
    expect(block).not.toMatch(/AgentMemoryModel\.findByAgentId\(/);
  });
});
