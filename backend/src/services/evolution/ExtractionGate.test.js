// The novelty gate in front of insight extraction.
//
// Measured on May 2026 traffic: 4,000 workflow executions collapse to 33
// distinct outcome shapes, so this gate removes 99.2% of the LLM extraction
// calls that produced the 50,194 memory rows written that month. The largest
// single repeat group is 820 executions with a byte-identical outcome.
//
// The property that makes it safe is that it can only ever suppress a REPEAT.
// A failure, a new node, or a status flip changes the signature and extracts
// immediately — which is the only case anyone wanted an insight about.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const get = vi.fn((sql, params, cb) => cb(null, null));
const run = vi.fn((sql, params, cb) => cb && cb.call({ changes: 1 }, null));
vi.mock('../../models/database/index.js', () => ({
  default: { get: (...a) => get(...a), run: (...a) => run(...a) },
}));

const { shouldExtract, workflowSignature, EXTRACTION_COOLDOWN_MS } =
  await import('./ExtractionGate.js');

const exec = (status = 'completed') => ({ id: 'e1', workflow_id: 'wf1', status });
const nodes = (...specs) => specs.map(([node_id, status, error]) => ({ node_id, status, error }));

const HAPPY = nodes(['timer', 'completed'], ['fetch', 'completed'], ['email', 'completed']);

beforeEach(() => {
  get.mockReset(); run.mockReset();
  get.mockImplementation((sql, params, cb) => cb(null, null));
  run.mockImplementation((sql, params, cb) => cb && cb.call({ changes: 1 }, null));
});

describe('workflowSignature', () => {
  it('is stable across identical runs', () => {
    expect(workflowSignature(exec(), HAPPY)).toBe(workflowSignature(exec(), HAPPY));
  });

  it('ignores node completion ORDER', () => {
    // Parallel branches finish nondeterministically; without sorting, every run
    // would look novel and the gate would never fire.
    const shuffled = nodes(['email', 'completed'], ['timer', 'completed'], ['fetch', 'completed']);
    expect(workflowSignature(exec(), shuffled)).toBe(workflowSignature(exec(), HAPPY));
  });

  it('CHANGES when a node fails', () => {
    const failed = nodes(['timer', 'completed'], ['fetch', 'failed'], ['email', 'completed']);
    expect(workflowSignature(exec(), failed)).not.toBe(workflowSignature(exec(), HAPPY));
  });

  it('CHANGES when the workflow status flips', () => {
    expect(workflowSignature(exec('failed'), HAPPY)).not.toBe(workflowSignature(exec('completed'), HAPPY));
  });

  it('CHANGES when a node reports an error even with an ok status', () => {
    const withErr = nodes(['timer', 'completed'], ['fetch', 'completed', 'ETIMEDOUT'], ['email', 'completed']);
    expect(workflowSignature(exec(), withErr)).not.toBe(workflowSignature(exec(), HAPPY));
  });

  it('CHANGES when the node set changes', () => {
    const extra = [...HAPPY, { node_id: 'slack', status: 'completed' }];
    expect(workflowSignature(exec(), extra)).not.toBe(workflowSignature(exec(), HAPPY));
  });

  it('preserves REPEATED node ids — a node running twice is the signal', () => {
    // "Duplicate timer trigger execution" is the single largest cluster in the
    // store. De-duplicating the multiset would erase exactly that finding.
    const twice = nodes(['timer', 'completed'], ['timer', 'completed'], ['fetch', 'completed'], ['email', 'completed']);
    const once = nodes(['timer', 'completed'], ['fetch', 'completed'], ['email', 'completed']);
    expect(workflowSignature(exec(), twice)).not.toBe(workflowSignature(exec(), once));
  });

  it('does NOT vary with duration', () => {
    // Durations are continuous; including them would make every run novel and
    // collapse the gate back into "extract everything".
    const slow = HAPPY.map((n) => ({ ...n, start_time: '2026-05-01T00:00:00Z', end_time: '2026-05-01T00:09:00Z' }));
    expect(workflowSignature(exec(), slow)).toBe(workflowSignature(exec(), HAPPY));
  });

  it('does not throw on empty or malformed input', () => {
    expect(typeof workflowSignature(exec(), [])).toBe('string');
    expect(typeof workflowSignature(null, [])).toBe('string');
    expect(typeof workflowSignature(exec(), [{}])).toBe('string');
  });
});

describe('shouldExtract', () => {
  const base = { userId: 'u1', sourceType: 'workflow', scopeId: 'wf1', signature: 'sig1' };

  it('extracts an unseen signature and records it', () => {
    get.mockImplementation((sql, params, cb) => cb(null, null));
    return shouldExtract(base).then((r) => {
      expect(r.extract).toBe(true);
      expect(r.reason).toBe('novel');
      expect(run.mock.calls.some(([sql]) => /INSERT INTO extraction_gate/.test(sql))).toBe(true);
    });
  });

  it('SUPPRESSES a repeat inside the cooldown', async () => {
    const now = Date.now();
    get.mockImplementation((sql, params, cb) => cb(null, {
      occurrence_count: 819,
      last_extracted_at: new Date(now - 60_000).toISOString(),
    }));
    const r = await shouldExtract({ ...base, now });
    expect(r.extract).toBe(false);
    expect(r.reason).toBe('repeat-suppressed');
    expect(r.occurrences).toBe(820);
  });

  it('re-extracts once the cooldown elapses', async () => {
    const now = Date.now();
    get.mockImplementation((sql, params, cb) => cb(null, {
      occurrence_count: 5,
      last_extracted_at: new Date(now - EXTRACTION_COOLDOWN_MS - 1000).toISOString(),
    }));
    const r = await shouldExtract({ ...base, now });
    expect(r.extract).toBe(true);
    expect(r.reason).toBe('cooldown-elapsed');
  });

  it('counts every sighting even when suppressed', async () => {
    // occurrence_count is the census the consolidation pass needs.
    get.mockImplementation((sql, params, cb) => cb(null, {
      occurrence_count: 10, last_extracted_at: new Date().toISOString(),
    }));
    await shouldExtract(base);
    const upd = run.mock.calls.find(([sql]) => /UPDATE extraction_gate/.test(sql));
    expect(upd).toBeTruthy();
    expect(upd[1][0]).toBe(11);
  });

  it('does not advance last_extracted_at while suppressing', async () => {
    // Otherwise the cooldown would never elapse for a busy workflow and the
    // finding would go permanently stale.
    get.mockImplementation((sql, params, cb) => cb(null, {
      occurrence_count: 1, last_extracted_at: new Date().toISOString(),
    }));
    await shouldExtract(base);
    const [sql] = run.mock.calls.find(([s]) => /UPDATE extraction_gate/.test(s));
    expect(sql).not.toContain('last_extracted_at =');
  });

  it('FAILS OPEN when the gate table errors', async () => {
    // Losing an insight is a worse failure than paying for a redundant one.
    get.mockImplementation((sql, params, cb) => cb(new Error('no such table')));
    const r = await shouldExtract(base);
    expect(r.extract).toBe(true);
    expect(r.reason).toBe('gate-error');
  });

  it('is ungated when identifiers are missing', async () => {
    for (const missing of [{ userId: null }, { scopeId: null }, { signature: null }]) {
      const r = await shouldExtract({ ...base, ...missing });
      expect(r.extract).toBe(true);
      expect(r.reason).toBe('ungated');
    }
  });
});

describe('schema + wiring contract', () => {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  // Comments are STRIPPED before asserting. The doc comment in ExtractionGate
  // explains the node_type trap by name, so a naive `not.toContain` would be
  // decided by prose rather than by code — a test that fails because of its
  // own explanation is worse than no test.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const GATE = stripComments(fs.readFileSync(path.join(HERE, 'ExtractionGate.js'), 'utf8'));
  const ENGINE = fs.readFileSync(path.join(HERE, 'InsightEngine.js'), 'utf8');
  const SCHEMA = fs.readFileSync(path.join(HERE, '..', '..', 'models', 'database', 'index.js'), 'utf8');

  it('reads node_id — the column that exists — and never node_type', () => {
    // An earlier draft read `n.node_type || n.type || 'node'`. There is no such
    // column, and the || fallback meant every node collapsed to the constant
    // "node": the gate still ran, still looked correct, and could no longer
    // tell two workflows apart. Silent degradation, caught only by a live probe.
    expect(GATE).toContain('n.node_id');
    expect(GATE).not.toContain('node_type');
  });

  it('the extraction_gate table is actually created', () => {
    // ANCHORED past the table name. `toContain('...extraction_gate')` is also
    // satisfied by `...extraction_gate_disabled` — a prefix match asserts a
    // prefix, not an identity, and the renamed table would have sailed through.
    expect(SCHEMA).toMatch(/CREATE TABLE IF NOT EXISTS extraction_gate\s*\(/);
    const idx = SCHEMA.search(/CREATE TABLE IF NOT EXISTS extraction_gate\s*\(/);
    const body = SCHEMA.slice(idx, SCHEMA.indexOf(')', idx));
    for (const col of ['user_id', 'source_type', 'scope_id', 'signature', 'occurrence_count', 'last_extracted_at']) {
      expect(body, `extraction_gate is missing ${col}`).toContain(col);
    }
    expect(body).toMatch(/PRIMARY KEY/);
  });

  it('the gate runs BEFORE the LLM call, not before the write', () => {
    // Gating the write still pays for every extraction. The whole point is to
    // skip the model call. Scoped to the workflow extractor so an unrelated
    // mention elsewhere in the file cannot satisfy it.
    const fnIdx = ENGINE.indexOf('static async _extractFromWorkflow');
    expect(fnIdx).toBeGreaterThan(-1);
    const fn = ENGINE.slice(fnIdx, ENGINE.indexOf('static async _extractFromToolUsage'));
    const gateIdx = fn.indexOf('shouldExtract({');
    const llmIdx = fn.indexOf('_llmExtractWorkflowInsights');
    const traceIdx = fn.indexOf('_buildWorkflowTrace');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(llmIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(llmIdx);
    // Also ahead of trace assembly — no point serialising a trace we discard.
    expect(gateIdx).toBeLessThan(traceIdx);
  });

  it('a suppressed extraction returns early', () => {
    const idx = ENGINE.indexOf('shouldExtract({');
    const block = ENGINE.slice(idx, idx + 700);
    expect(block).toMatch(/if \(!gate\.extract\)/);
    expect(block).toMatch(/return \[\]/);
  });

  it('scopes the gate to the workflow, not the execution', () => {
    // Keying on executionId would make every run novel by construction.
    const idx = ENGINE.indexOf('shouldExtract({');
    expect(ENGINE.slice(idx, idx + 400)).toMatch(/scopeId:\s*execution\.workflow_id/);
  });
});
