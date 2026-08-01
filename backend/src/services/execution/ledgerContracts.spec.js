/**
 * Systemic guard for the execution ledger (PRD-122).
 *
 * The ledger's value rests entirely on ONE claim: every LLM call in AGNT is
 * recorded by exactly one function. That claim is not enforced by any type or
 * interface — it is a convention, and conventions decay. Four subsystems each
 * grew their own bookkeeping precisely because nothing stopped them.
 *
 * These tests scan the real source tree and fail the build when the convention
 * is broken, so the next person to add a provider path cannot quietly reinvent
 * the thing this PRD deleted.
 *
 * COMMENTS ARE STRIPPED BEFORE SCANNING. Several files legitimately DESCRIBE
 * the old defect in prose (`0 as estimated_cost`), and a scanner that cannot
 * tell a description from an occurrence flags the fix as the bug. That mistake
 * has been made here before; isComment/stripComments below is the fix.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../..'); // backend/src

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);
const isTestFile = (f) => /\.(spec|test)\.[cm]?js$/.test(f);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (/\.[cm]?js$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Remove comments so the scanner sees CODE, never prose about code.
 *
 * Deliberately conservative: it strips block comments, whole-line `//`
 * comments, and trailing `//` comments only when the slashes are not inside a
 * string literal (checked by quote parity) and not part of a URL scheme.
 */
export function stripComments(source) {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlocks
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*')) return '';
      const idx = line.indexOf('//');
      if (idx === -1) return line;
      const before = line.slice(0, idx);
      if (before.endsWith(':')) return line; // http:// etc
      const quotes = (before.match(/['"`]/g) || []).length;
      if (quotes % 2 !== 0) return line; // the // sits inside a string
      return before;
    })
    .join('\n');
}

const FILES = walk(SRC).filter((f) => !isTestFile(path.basename(f)));
const CODE = new Map(FILES.map((f) => [f, stripComments(fs.readFileSync(f, 'utf8'))]));
const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');

describe('ledger contracts — the scanner itself', () => {
  it('ANTI-VACUITY: actually sees a substantial source tree', () => {
    // A guard that scans nothing passes everything.
    expect(FILES.length).toBeGreaterThan(200);
    expect([...CODE.values()].some((c) => c.includes('recordLlmCall'))).toBe(true);
  });

  it('strips prose but preserves code', () => {
    const sample = [
      '// used to read `0 as etc` here',
      'const a = 1; // trailing note',
      '/* block\n0 as etc\n*/',
      "const url = 'http://x/y';",
      "const s = 'a // not a comment';",
    ].join('\n');
    const out = stripComments(sample);
    expect(out).not.toMatch(/used to read/);
    expect(out).not.toMatch(/trailing note/);
    expect(out).toMatch(/const a = 1;/);
    expect(out).toMatch(/http:\/\/x\/y/);
    expect(out).toMatch(/a \/\/ not a comment/);
  });
});

describe('GUARD 1 — only LlmCallModel writes the ledger table', () => {
  it('has exactly one file containing an INSERT into llm_calls', () => {
    const offenders = [...CODE.entries()]
      .filter(([, code]) => /INSERT\s+(OR\s+\w+\s+)?INTO\s+llm_calls/i.test(code))
      .map(([f]) => rel(f));

    expect(offenders).toEqual(['models/LlmCallModel.js']);
  });
});

describe('GUARD 2 — only LedgerRecorder calls the model', () => {
  it('has exactly one file invoking LlmCallModel.create', () => {
    const offenders = [...CODE.entries()]
      .filter(([, code]) => /LlmCallModel\s*\.\s*create\s*\(/.test(code))
      .map(([f]) => rel(f));

    // If this list grows, a second write path has appeared and the ledger's
    // single-source-of-truth property is gone.
    expect(offenders).toEqual(['services/execution/LedgerRecorder.js']);
  });

  it('ANTI-VACUITY: the detector matches a synthetic violation', () => {
    const fake = stripComments('const x = await LlmCallModel.create({ userId });');
    expect(/LlmCallModel\s*\.\s*create\s*\(/.test(fake)).toBe(true);
  });
});

describe('GUARD 3 — the original defect cannot come back', () => {
  it('contains no hard-coded zero cost column in any SQL', () => {
    // `0 as estimated_cost` in the activity rollup is why every workflow LLM
    // call in AGNT was reported as free. The phrase still appears in comments
    // explaining the fix, which is exactly why this scan strips them first.
    const offenders = [...CODE.entries()]
      .filter(([, code]) => /\b0\s+as\s+estimated_cost\b/i.test(code))
      .map(([f]) => rel(f));

    expect(offenders).toEqual([]);
  });

  it('ANTI-VACUITY: the pattern is still detectable in code form', () => {
    expect(/\b0\s+as\s+estimated_cost\b/i.test(stripComments('SELECT 0 as estimated_cost FROM t'))).toBe(true);
  });
});

describe('GUARD 4 — cost is never coerced away from NULL at the write site', () => {
  it('LedgerRecorder passes a missing price through as null, not 0', () => {
    const recorder = CODE.get(path.join(SRC, 'services', 'execution', 'LedgerRecorder.js'));
    expect(recorder).toBeTruthy();

    // The ternaries must fall back to null. `priced?.totalCost || 0` would
    // silently reintroduce the zero-means-free defect one layer down, and
    // would also round a genuinely-free call and an unpriceable one together.
    expect(recorder).toMatch(/costUsd:\s*priced\s*\?\s*priced\.totalCost\s*:\s*null/);
    expect(recorder).toMatch(/uncachedCostUsd:\s*baseline\s*\?\s*baseline\.totalCost\s*:\s*null/);
    expect(recorder).not.toMatch(/costUsd:\s*[\w.?]*\s*\|\|\s*0/);
  });
});

describe('GUARD 5 — spend attribution is never hard-coded in a shared helper', () => {
  it('executeTaskViaAgentChat takes its origin from the caller', () => {
    const orch = CODE.get(path.join(SRC, 'services', 'goal', 'TaskOrchestrator.js'));
    expect(orch).toBeTruthy();

    // This helper has two callers with different correct answers (the goal
    // system and the run_agent tool). A literal origin here filed every
    // run_agent invocation under goal spend with a null goal id.
    expect(orch).not.toMatch(/ledger:\s*\{\s*origin:\s*'goal_task'/);
    expect(orch).toMatch(/ledger:\s*ledgerCtx/);
  });

  it('ANTI-VACUITY: the detector matches the shape it forbids', () => {
    expect(/ledger:\s*\{\s*origin:\s*'goal_task'/.test("ledger: { origin: 'goal_task', originId: x },")).toBe(true);
  });
});

describe('GUARD 6 — the dropped-write tripwire spans processes', () => {
  it('persists failures rather than only counting them in memory', () => {
    const recorder = CODE.get(path.join(SRC, 'services', 'execution', 'LedgerRecorder.js'));
    expect(recorder).toBeTruthy();

    // AGNT runs the workflow engine in its own OS process. An in-memory-only
    // counter is invisible to whichever process serves /api/ledger/summary,
    // which makes it a tripwire that cannot trip for the riskiest path.
    expect(recorder).toMatch(/noteWriteFailure\(/);
    expect(recorder).toMatch(/IS_WORKFLOW_PROCESS/);
  });

  it('the HTTP surface reports the cross-process total, not just its own', () => {
    const routes = CODE.get(path.join(SRC, 'routes', 'LedgerRoutes.js'));
    expect(routes).toMatch(/writeFailures\(\)/);
    expect(routes).toMatch(/totalFailures/);
  });
});

describe('GUARD 7 — no tool reports success for work it did not do', () => {
  it('run_agent no longer fabricates an execution id', () => {
    const tools = CODE.get(path.join(SRC, 'services', 'orchestrator', 'agentTools.js'));
    expect(tools).toBeTruthy();

    // The old stub returned `executionId: \`exec-${Date.now()}\`` alongside
    // success:true while starting nothing at all.
    expect(tools).not.toMatch(/exec-\$\{Date\.now\(\)\}/);
    expect(tools).toMatch(/AgentExecutionModel/);
  });
});
