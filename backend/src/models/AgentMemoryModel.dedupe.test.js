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
    // Seen again = more evidence for the same finding, recorded as a census bump.
    expect(run.mock.calls.some(([sql]) => /occurrence_count = COALESCE/.test(sql))).toBe(true);
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
    // ... content_shape, last_seen_at
    expect(params.at(-2)).toBeTruthy();
  });

  it('seeds the occurrence census on insert', async () => {
    await AgentMemoryModel.create({ agentId: 'orchestrator', userId: 'u1', memoryType: 'pattern', content: TIMER_A });
    const [sql, params] = insertCalls()[0];
    expect(sql).toContain('occurrence_count');
    expect(sql).toContain('last_seen_at');
    expect(params.at(-1)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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
    expect(params.at(-2)).toBeNull();
  });

  it('never runs the FTS similarity probe for user-set types', async () => {
    await AgentMemoryModel.create({
      agentId: 'orchestrator', userId: 'u1', memoryType: 'fact',
      content: 'Nathan prefers green and works out of the agnt-pro repository on Windows',
    });
    expect(all.mock.calls.filter(([sql]) => /agent_memory_fts MATCH/.test(sql))).toHaveLength(0);
  });
});

// The shape key only collapses 1.56x on live data because the extractor is an
// LLM and rewords every time. FTS blocking + token containment is what catches
// the paraphrases: replayed against the May 2026 firehose it blocked 51.5% of
// writes for a 2.1x collapse.
describe('FTS containment gate (the paraphrase catcher)', () => {
  const ORIGINAL = 'The direct read_file call failed due to path traversal restrictions on a Windows absolute path, while file_system_operation succeeded for the same target';
  const REWORDED = 'Direct read_file on the full Windows path failed due to path traversal restrictions, while file_system_operation succeeded reading the same file';
  const UNRELATED = 'The user prefers dark mode and a compact sidebar layout in the workflow editor canvas';

  const ftsProbes = () => all.mock.calls.filter(([sql]) => /agent_memory_fts MATCH/.test(sql));

  const withCandidate = (content) => {
    all.mockImplementation((sql, params, cb) => {
      if (/agent_memory_fts MATCH/.test(sql)) return cb(null, [{ doc_id: 'old-id', content }]);
      return cb(null, []);
    });
    get.mockImplementation((sql, params, cb) => {
      if (/content_shape = \?/.test(sql)) return cb(null, null);
      if (/WHERE id = \?/.test(sql)) return cb(null, { id: 'old-id', content });
      return cb(null, null);
    });
  };

  it('collapses a reworded duplicate the shape key misses', async () => {
    withCandidate(ORIGINAL);
    const id = await AgentMemoryModel.create({
      agentId: 'orchestrator', userId: 'u1', memoryType: 'workflow_insight', content: REWORDED,
    });
    expect(id).toBe('old-id');
    expect(insertCalls()).toHaveLength(0);
    expect(run.mock.calls.some(([sql]) => /occurrence_count = COALESCE/.test(sql))).toBe(true);
  });

  it('inserts when the BM25 candidate is not actually the same finding', async () => {
    // BM25 is the blocker, not the decision — it will happily return something
    // that merely shares vocabulary.
    withCandidate(UNRELATED);
    const id = await AgentMemoryModel.create({
      agentId: 'orchestrator', userId: 'u1', memoryType: 'workflow_insight', content: REWORDED,
    });
    expect(id).toBe('new-uuid');
    expect(insertCalls()).toHaveLength(1);
  });

  it('scopes the probe to the same agent AND memory_type', async () => {
    // A `pattern` and a `workflow_insight` sharing vocabulary are different
    // KINDS of claim; collapsing across types loses what retrieval depends on.
    withCandidate(ORIGINAL);
    await AgentMemoryModel.create({
      agentId: 'agent-7', userId: 'u1', memoryType: 'pattern', content: REWORDED,
    });
    const [sql, params] = ftsProbes()[0];
    expect(sql).toContain('agent_id = ?');
    expect(sql).toContain('memory_type = ?');
    expect(params).toContain('agent-7');
    expect(params).toContain('pattern');
  });

  it('ranks candidates by BM25 and bounds the window', async () => {
    withCandidate(ORIGINAL);
    await AgentMemoryModel.create({
      agentId: 'orchestrator', userId: 'u1', memoryType: 'pattern', content: REWORDED,
    });
    const [sql] = ftsProbes()[0];
    expect(sql).toMatch(/ORDER BY bm25\(agent_memory_fts\)/);
    expect(sql).toMatch(/LIMIT \?/);
  });

  it('runs the shape probe FIRST and skips FTS on a shape hit', async () => {
    // Cheapest matcher first: one indexed lookup beats a full-text query.
    get.mockImplementation((sql, params, cb) => {
      if (/content_shape = \?/.test(sql)) return cb(null, { id: 'shape-hit' });
      return cb(null, null);
    });
    const id = await AgentMemoryModel.create({
      agentId: 'orchestrator', userId: 'u1', memoryType: 'pattern', content: ORIGINAL,
    });
    expect(id).toBe('shape-hit');
    expect(ftsProbes()).toHaveLength(0);
  });

  it('FAILS OPEN — an FTS error inserts rather than losing the memory', async () => {
    all.mockImplementation((sql, params, cb) => {
      if (/agent_memory_fts MATCH/.test(sql)) return cb(new Error('fts5: syntax error'));
      return cb(null, []);
    });
    const id = await AgentMemoryModel.create({
      agentId: 'orchestrator', userId: 'u1', memoryType: 'pattern', content: REWORDED,
    });
    expect(id).toBe('new-uuid');
    expect(insertCalls()).toHaveLength(1);
  });

  it('does not rewrite the stored wording on a match', async () => {
    // We cannot tell which paraphrase is better, and rewriting would churn the
    // FTS row and the shape key on every sighting. First wording wins.
    withCandidate(ORIGINAL);
    await AgentMemoryModel.create({
      agentId: 'orchestrator', userId: 'u1', memoryType: 'pattern', content: REWORDED,
    });
    expect(run.mock.calls.some(([sql]) => /SET content\s*=/.test(sql))).toBe(false);
  });

  it('recording a sighting does not touch updated_at', async () => {
    // updated_at is a relevance sort key — writing it here would make recording
    // a duplicate silently reorder retrieval.
    withCandidate(ORIGINAL);
    await AgentMemoryModel.create({
      agentId: 'orchestrator', userId: 'u1', memoryType: 'pattern', content: REWORDED,
    });
    const [sql] = run.mock.calls.find(([s]) => /occurrence_count = COALESCE/.test(s));
    expect(sql).not.toContain('updated_at');
    expect(sql).toContain('last_seen_at');
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
