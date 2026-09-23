/**
 * DataExportService — the Settings → Backup & Export download.
 *
 * Runs the REAL service against a throwaway sqlite3 database with the real
 * column shapes, so the tests fail if the SQL drifts. What is pinned:
 *
 *  - ISOLATION: another user's rows never appear, in any category, including
 *    workflow versions (scoped through workflows) and nested children.
 *  - COMPLETENESS: keyset paging returns every row exactly once, children
 *    are nested under the right parent, externalized node payloads are read
 *    back from the blob store, compressed workflow versions are inflated.
 *  - DATES: tables mix "YYYY-MM-DD HH:MM:SS" and ISO; filters are inclusive
 *    on both ends for both.
 *  - DOCUMENT: always parses; `complete:true` only when it really is; a
 *    mid-stream failure still yields valid JSON that says complete:false.
 *  - TICKETS: single use, expiring, bound to the minting user.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import http from 'http';
import express from 'express';
import sqlite3 from 'sqlite3';
import { PassThrough } from 'stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let rawDb;
let TMP;
let prevAgntHome;

vi.mock('../models/database/index.js', () => ({
  default: {
    all: (...a) => rawDb.all(...a),
    get: (...a) => rawDb.get(...a),
    run: (...a) => rawDb.run(...a),
  },
}));

// The download guard reads the session cookie in production; here the same header names the user.
vi.mock('../utils/authGuard.js', () => ({
  requireAuth: () => (req, res, next) => {
    const user = req.headers['x-test-user'];
    if (!user) return res.status(401).json({ success: false, error: 'auth required' });
    req.user = { userId: user };
    next();
  },
}));

// Route tests: stand in for JWT auth with a header naming the user.
vi.mock('../routes/Middleware.js', () => ({
  authenticateToken: (req, res, next) => {
    const user = req.headers['x-test-user'];
    if (!user) return res.status(401).json({ success: false, error: 'auth required' });
    req.user = { userId: user };
    next();
  },
}));

let Service;
let PayloadStore;
let MemoryRoutes;

beforeAll(async () => {
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-export-'));
  prevAgntHome = process.env.AGNT_HOME;
  process.env.AGNT_HOME = TMP;
  Service = await import('./DataExportService.js');
  PayloadStore = (await import('./storage/PayloadStore.js')).default;
  MemoryRoutes = (await import('../routes/MemoryRoutes.js')).default;
});

afterAll(() => {
  if (prevAgntHome === undefined) delete process.env.AGNT_HOME;
  else process.env.AGNT_HOME = prevAgntHome;
  fs.rmSync(TMP, { recursive: true, force: true });
});

const run = (sql, params = []) =>
  new Promise((resolve, reject) => rawDb.run(sql, params, (e) => (e ? reject(e) : resolve())));
const exec = (sql) => new Promise((resolve, reject) => rawDb.exec(sql, (e) => (e ? reject(e) : resolve())));

const SCHEMA = `
CREATE TABLE agent_memory (id TEXT PRIMARY KEY, agent_id TEXT, user_id TEXT, memory_type TEXT, content TEXT, created_at TEXT);
CREATE TABLE insights (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, evidence TEXT, created_at TEXT);
CREATE TABLE conversation_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT, user_id TEXT, initial_prompt TEXT, full_history TEXT, updated_at TEXT);
CREATE TABLE agent_executions (id TEXT PRIMARY KEY, user_id TEXT, agent_name TEXT, status TEXT, start_time TEXT);
CREATE TABLE agent_tool_executions (id TEXT PRIMARY KEY, execution_id TEXT, tool_name TEXT, start_time TEXT, input TEXT, output TEXT);
CREATE TABLE workflow_executions (id TEXT PRIMARY KEY, workflow_id TEXT, user_id TEXT, start_time TEXT, log TEXT);
CREATE TABLE node_executions (id TEXT PRIMARY KEY, execution_id TEXT, node_id TEXT, start_time TEXT, input TEXT, output TEXT);
CREATE TABLE goals (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, created_at TEXT);
CREATE TABLE tasks (id TEXT PRIMARY KEY, goal_id TEXT, title TEXT, order_index INTEGER);
CREATE TABLE goal_evaluations (id TEXT PRIMARY KEY, goal_id TEXT, score REAL, created_at TEXT);
CREATE TABLE content_outputs (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, content TEXT, updated_at TEXT);
CREATE TABLE workflows (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, workflow_data TEXT, created_at TEXT, deleted_at TEXT);
CREATE TABLE tools (id TEXT PRIMARY KEY, title TEXT, created_by TEXT, config TEXT, created_at TEXT);
CREATE TABLE skills (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, is_builtin INTEGER, created_at TEXT);
CREATE TABLE skill_versions (id TEXT PRIMARY KEY, skill_id TEXT, user_id TEXT, version INTEGER, created_at TEXT);
CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT, created_by TEXT, tools TEXT, created_at TEXT, deleted_at TEXT);
CREATE TABLE agent_resources (agent_id TEXT PRIMARY KEY, credit_limit INTEGER, credits_used INTEGER);
CREATE TABLE agent_workflows (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, workflow_id TEXT);
CREATE TABLE widget_definitions (id TEXT PRIMARY KEY, user_id TEXT, name TEXT, source_code TEXT, created_at TEXT);
CREATE TABLE workflow_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, workflow_id TEXT, version_number INTEGER, workflow_state TEXT, is_compressed INTEGER, created_at TEXT);
`;

const A = 'user-a';
const B = 'user-b';

async function seed() {
  // Memories: mixed timestamp formats, one per day across a boundary.
  await run(`INSERT INTO agent_memory VALUES ('m1','annie',?, 'fact','likes tea','2026-09-01 23:59:59')`, [A]);
  await run(`INSERT INTO agent_memory VALUES ('m2','annie',?, 'fact','{"structured":true}','2026-09-02T00:00:00.000Z')`, [A]);
  await run(`INSERT INTO agent_memory VALUES ('m3','annie',?, 'fact','not {json','2026-09-03 08:00:00')`, [A]);
  await run(`INSERT INTO agent_memory VALUES ('mb','annie',?, 'fact','SECRET-OF-B','2026-09-02 10:00:00')`, [B]);

  await run(`INSERT INTO insights VALUES ('i1',?,'faster','[1,2,3]','2026-09-02 10:00:00')`, [A]);
  await run(`INSERT INTO insights VALUES ('ib',?,'SECRET-OF-B','[]','2026-09-02 10:00:00')`, [B]);

  await run(`INSERT INTO conversation_logs (conversation_id,user_id,initial_prompt,full_history,updated_at) VALUES ('c1',?,'hi','[{"role":"user","content":"hi"}]','2026-09-02 10:00:00')`, [A]);
  await run(`INSERT INTO conversation_logs (conversation_id,user_id,initial_prompt,full_history,updated_at) VALUES ('cb',?,'SECRET-OF-B','[]','2026-09-02 10:00:00')`, [B]);

  await run(`INSERT INTO agent_executions VALUES ('e1',?,'Annie','completed','2026-09-02T10:00:00.000Z')`, [A]);
  await run(`INSERT INTO agent_executions VALUES ('e2',?,'Annie','failed','2026-09-02T11:00:00.000Z')`, [A]);
  await run(`INSERT INTO agent_executions VALUES ('eb',?,'SECRET-OF-B','completed','2026-09-02T10:00:00.000Z')`, [B]);
  await run(`INSERT INTO agent_tool_executions VALUES ('t2','e1','read_file','2026-09-02T10:00:02Z','{"path":"b"}','ok')`);
  await run(`INSERT INTO agent_tool_executions VALUES ('t1','e1','web_search','2026-09-02T10:00:01Z','{"q":"a"}','{"hits":1}')`);
  await run(`INSERT INTO agent_tool_executions VALUES ('tb','eb','SECRET-OF-B','2026-09-02T10:00:01Z','{}','{}')`);

  // One node output is large enough to be externalized to the blob store.
  const bigOutput = { text: 'x'.repeat(20_000), marker: 'from-blob' };
  const packed = await PayloadStore.pack(bigOutput);
  await run(`INSERT INTO workflow_executions VALUES ('w1','wf1',?,'2026-09-02T09:00:00Z','{"lines":2}')`, [A]);
  await run(`INSERT INTO workflow_executions VALUES ('wb','wfb',?,'2026-09-02T09:00:00Z','{}')`, [B]);
  await run(`INSERT INTO node_executions VALUES ('n1','w1','trigger','2026-09-02T09:00:00Z','{"a":1}',?)`, [packed]);
  await run(`INSERT INTO node_executions VALUES ('nb','wb','SECRET-OF-B','2026-09-02T09:00:00Z','{}','{}')`);

  await run(`INSERT INTO goals VALUES ('g1',?,'ship','2026-09-02T09:00:00.000Z')`, [A]);
  await run(`INSERT INTO goals VALUES ('gb',?,'SECRET-OF-B','2026-09-02T09:00:00.000Z')`, [B]);
  await run(`INSERT INTO tasks VALUES ('k2','g1','second',2)`);
  await run(`INSERT INTO tasks VALUES ('k1','g1','first',1)`);
  await run(`INSERT INTO tasks VALUES ('kb','gb','SECRET-OF-B',1)`);
  await run(`INSERT INTO goal_evaluations VALUES ('v1','g1',0.9,'2026-09-02')`);

  await run(`INSERT INTO content_outputs VALUES ('o1',?,'report','# hello','2026-09-02 12:00:00')`, [A]);
  await run(`INSERT INTO content_outputs VALUES ('ob',?,'SECRET-OF-B','x','2026-09-02 12:00:00')`, [B]);

  await run(`INSERT INTO workflows VALUES ('wf1',?,'mine','{"nodes":[]}','2026-09-02 08:00:00',NULL)`, [A]);
  await run(`INSERT INTO workflows VALUES ('wfgone',?,'deleted','{}','2026-09-02 08:00:00','2026-09-03')`, [A]);
  await run(`INSERT INTO workflows VALUES ('wfb',?,'SECRET-OF-B','{}','2026-09-02 08:00:00',NULL)`, [B]);

  // Your work. Built-in skills and deleted agents are not the user's work to carry.
  await run(`INSERT INTO tools VALUES ('tool1','Summarize',?,'{"provider":"openai"}','2026-09-02 08:00:00')`, [A]);
  await run(`INSERT INTO tools VALUES ('toolb','SECRET-OF-B',?,'{}','2026-09-02 08:00:00')`, [B]);
  await run(`INSERT INTO skills VALUES ('sk1',?,'writing',0,'2026-09-02 08:00:00')`, [A]);
  await run(`INSERT INTO skills VALUES ('skbuiltin',?,'builtin',1,'2026-09-02 08:00:00')`, [A]);
  await run(`INSERT INTO skills VALUES ('skb',?,'SECRET-OF-B',0,'2026-09-02 08:00:00')`, [B]);
  await run(`INSERT INTO skill_versions VALUES ('sv1','sk1',?,1,'2026-09-02 08:00:00')`, [A]);
  await run(`INSERT INTO agents VALUES ('ag1','Researcher',?,'["tool1"]','2026-09-02 08:00:00',NULL)`, [A]);
  await run(`INSERT INTO agents VALUES ('aggone','Old',?,'[]','2026-09-02 08:00:00','2026-09-03')`, [A]);
  await run(`INSERT INTO agents VALUES ('agb','SECRET-OF-B',?,'[]','2026-09-02 08:00:00',NULL)`, [B]);
  await run(`INSERT INTO agent_resources VALUES ('ag1',1000,5)`);
  await run(`INSERT INTO agent_workflows (agent_id,workflow_id) VALUES ('ag1','wf1')`);
  await run(`INSERT INTO widget_definitions VALUES ('wd1',?,'Clock','<div/>','2026-09-02 08:00:00')`, [A]);
  await run(`INSERT INTO widget_definitions VALUES ('wdb',?,'SECRET-OF-B','','2026-09-02 08:00:00')`, [B]);
  const state = JSON.stringify({ nodes: [{ id: 'n' }], edges: [] });
  const compressed = zlib.gzipSync(state).toString('base64');
  await run(`INSERT INTO workflow_versions (workflow_id,version_number,workflow_state,is_compressed,created_at) VALUES ('wf1',1,?,1,'2026-09-02 10:00:00')`, [compressed]);
  await run(`INSERT INTO workflow_versions (workflow_id,version_number,workflow_state,is_compressed,created_at) VALUES ('wf1',2,?,0,'2026-09-02 11:00:00')`, [state]);
  await run(`INSERT INTO workflow_versions (workflow_id,version_number,workflow_state,is_compressed,created_at) VALUES ('wfb',1,'SECRET-OF-B',0,'2026-09-02 10:00:00')`);
}

beforeEach(async () => {
  if (rawDb) await new Promise((r) => rawDb.close(r));
  rawDb = new sqlite3.Database(':memory:');
  await exec(SCHEMA);
  await seed();
});

/** A writable that looks enough like an Express response for streamExport. */
function fakeResponse() {
  const res = new PassThrough();
  const chunks = [];
  res.on('data', (c) => chunks.push(c));
  res.headers = {};
  res.statusCode = 0;
  res.status = (code) => { res.statusCode = code; return res; };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.body = () => Buffer.concat(chunks);
  res.finished$ = new Promise((resolve) => res.on('finish', resolve));
  return res;
}

async function exportDoc(options) {
  const res = fakeResponse();
  const result = await Service.streamExport({ userId: A, options: Service.normalizeExportOptions(options), res });
  await res.finished$;
  const bytes = options?.compress ? zlib.gunzipSync(res.body()) : res.body();
  return { doc: JSON.parse(bytes.toString('utf8')), res, result };
}

describe('DataExportService — full export', () => {
  it('exports every category for the user and nothing belonging to anyone else', async () => {
    const { doc, result } = await exportDoc({ categories: 'all' });
    expect(doc.format).toBe('agnt-data-export');
    expect(doc.complete).toBe(true);
    expect(result.complete).toBe(true);
    expect(doc.categories).toEqual(Service.EXPORT_CATEGORIES.map((c) => c.id));
    expect(JSON.stringify(doc)).not.toContain('SECRET-OF-B');
    expect(doc.counts).toEqual({
      tools: 1, skills: 1, workflows: 1, agents: 1, widgets: 1,
      memories: 3, insights: 1, conversations: 1, traces: 2, workflowRuns: 1, goals: 1, outputs: 1, workflowVersions: 2,
    });
    for (const [id, n] of Object.entries(doc.counts)) expect(doc[id]).toHaveLength(n);
  });

  it('carries your work with what it needs, and never built-ins, deleted items or anyone else\'s', async () => {
    const { doc } = await exportDoc({ categories: ['tools', 'skills', 'workflows', 'agents', 'widgets'] });
    expect(doc.skills.map((s) => s.id)).toEqual(['sk1']);
    expect(doc.skills[0].versions.map((v) => v.id)).toEqual(['sv1']);
    expect(doc.agents.map((a) => a.id)).toEqual(['ag1']);
    expect(doc.agents[0].tools).toEqual(['tool1']);
    expect(doc.agents[0].resources).toEqual([{ agent_id: 'ag1', credit_limit: 1000, credits_used: 5 }]);
    expect(doc.agents[0].workflowLinks.map((l) => l.workflow_id)).toEqual(['wf1']);
    expect(doc.workflows.map((w) => w.id)).toEqual(['wf1']);
    expect(JSON.stringify(doc)).not.toContain('SECRET-OF-B');
  });

  it('narrows history by date but always carries your work whole', async () => {
    const { doc } = await exportDoc({ categories: ['agents', 'memories'], since: '2030-01-01' });
    expect(doc.agents.map((a) => a.id)).toEqual(['ag1']);
    expect(doc.memories).toEqual([]);
  });

  it('lists your work first, in dependency order, each labelled with its group', async () => {
    const counts = await Service.countExportCategories(A);
    expect(counts.slice(0, 5).map((c) => [c.id, c.group])).toEqual([['tools', 'work'], ['skills', 'work'], ['workflows', 'work'], ['agents', 'work'], ['widgets', 'work']]);
    expect(counts.slice(5).every((c) => c.group === 'history')).toBe(true);
  });

  it('nests children under their parent in order, and gives childless parents an empty list', async () => {
    const { doc } = await exportDoc({ categories: ['traces', 'goals'] });
    const e1 = doc.traces.find((t) => t.id === 'e1');
    const e2 = doc.traces.find((t) => t.id === 'e2');
    expect(e1.toolExecutions.map((t) => t.id)).toEqual(['t1', 't2']);
    expect(e2.toolExecutions).toEqual([]);
    expect(doc.goals[0].tasks.map((t) => t.title)).toEqual(['first', 'second']);
    expect(doc.goals[0].evaluations).toHaveLength(1);
  });

  it('decodes JSON stored in text columns and keeps everything else verbatim', async () => {
    const { doc } = await exportDoc({ categories: ['memories', 'conversations', 'traces'] });
    expect(doc.memories.find((m) => m.id === 'm2').content).toEqual({ structured: true });
    expect(doc.memories.find((m) => m.id === 'm3').content).toBe('not {json');
    expect(doc.memories.find((m) => m.id === 'm1').content).toBe('likes tea');
    expect(doc.conversations[0].full_history).toEqual([{ role: 'user', content: 'hi' }]);
    expect(doc.traces[0].toolExecutions.find((t) => t.id === 't2').output).toBe('ok');
  });

  it('reads externalized node payloads back from the blob store', async () => {
    const { doc } = await exportDoc({ categories: ['workflowRuns'] });
    const node = doc.workflowRuns[0].nodeExecutions[0];
    expect(node.output.marker).toBe('from-blob');
    expect(node.output.text).toHaveLength(20_000);
    expect(node.input).toEqual({ a: 1 });
    expect(doc.workflowRuns[0].log).toEqual({ lines: 2 });
  });

  it('inflates compressed workflow versions', async () => {
    const { doc } = await exportDoc({ categories: ['workflowVersions'] });
    for (const v of doc.workflowVersions) {
      expect(v.workflow_state).toEqual({ nodes: [{ id: 'n' }], edges: [] });
      expect(v.is_compressed).toBe(0);
    }
  });

  it('streams gzip that decompresses to the same document, with matching headers', async () => {
    const plain = await exportDoc({ categories: 'all' });
    const gz = await exportDoc({ categories: 'all', compress: true });
    expect({ ...gz.doc, exportedAt: 0 }).toEqual({ ...plain.doc, exportedAt: 0 });
    expect(gz.res.headers['content-type']).toBe('application/gzip');
    expect(gz.res.headers['content-disposition']).toMatch(/attachment; filename="agnt-export-all-\d{4}-\d{2}-\d{2}\.json\.gz"/);
    expect(plain.res.headers['cache-control']).toBe('no-store');
  });
});

describe('DataExportService — date filters', () => {
  it('is inclusive on both ends across mixed timestamp formats', async () => {
    const { doc } = await exportDoc({ categories: ['memories'], since: '2026-09-02', until: '2026-09-02' });
    expect(doc.memories.map((m) => m.id)).toEqual(['m2']);
    expect(doc.filters).toEqual({ since: '2026-09-02', until: '2026-09-02' });
    const open = await exportDoc({ categories: ['memories'], since: '2026-09-02' });
    expect(open.doc.memories.map((m) => m.id)).toEqual(['m2', 'm3']);
  });

  it('counts respect the same filters', async () => {
    const counts = await Service.countExportCategories(A, { until: '2026-09-01' });
    expect(counts.find((c) => c.id === 'memories').count).toBe(1);
    expect(counts.find((c) => c.id === 'traces').count).toBe(0);
  });
});

describe('DataExportService — paging', () => {
  it('returns every row exactly once across many small pages', async () => {
    for (let i = 0; i < 57; i++) {
      await run(`INSERT INTO agent_memory VALUES (?, 'annie', ?, 'fact', ?, '2026-09-05 00:00:00')`, [`p${i}`, A, `row ${i}`]);
      if (i % 3 === 0) await run(`INSERT INTO agent_memory VALUES (?, 'annie', ?, 'fact', 'SECRET-OF-B', '2026-09-05 00:00:00')`, [`pb${i}`, B]);
    }
    const memories = Service.EXPORT_CATEGORIES.find((c) => c.id === 'memories');
    const seen = [];
    let pages = 0;
    for await (const page of Service.readCategoryPages(memories, A, {}, { pageSize: 7 })) {
      pages += 1;
      seen.push(...page.map((r) => r.id));
    }
    expect(pages).toBeGreaterThan(8);
    expect(seen).toHaveLength(60);
    expect(new Set(seen).size).toBe(60);
    expect(seen.some((id) => id.startsWith('pb'))).toBe(false);
  });
});

describe('DataExportService — children across chunks', () => {
  it('streams many children in several chunks, in their recorded order', async () => {
    const order = Array.from({ length: 250 }, (_, i) => i).sort(() => Math.random() - 0.5);
    for (const i of order) {
      const ts = `2026-09-02T12:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`;
      await run(`INSERT INTO agent_tool_executions VALUES (?, 'e2', 'step', ?, '{}', ?)`, [`s${i}`, ts, JSON.stringify({ i })]);
    }
    const { doc } = await exportDoc({ categories: ['traces'] });
    const steps = doc.traces.find((t) => t.id === 'e2').toolExecutions;
    expect(steps).toHaveLength(250);
    expect(steps.map((s) => s.output.i)).toEqual(Array.from({ length: 250 }, (_, i) => i));
  });
});

describe('DataExportService — failure and disconnect', () => {
  it('a mid-stream failure still yields parseable JSON that says it is incomplete', async () => {
    await exec('DROP TABLE goals');
    const { doc, result } = await exportDoc({ categories: ['memories', 'goals', 'outputs'] });
    expect(doc.complete).toBe(false);
    expect(doc.error).toMatch(/no such table: goals/);
    expect(doc.memories).toHaveLength(3);
    expect(doc.goals).toEqual([]);
    expect(doc.counts).toEqual({ memories: 3, goals: 0 });
    expect(doc.outputs).toBeUndefined();
    expect(result.complete).toBe(false);
  });

  it('a failure in the middle of a nested child list still closes every open structure', async () => {
    await run(`INSERT INTO node_executions VALUES ('n2','w1','boom','2026-09-02T09:00:05Z','{}','{"fail":true}')`);
    const real = PayloadStore.unpack.bind(PayloadStore);
    const spy = vi.spyOn(PayloadStore, 'unpack').mockImplementation(async (stored) => {
      if (typeof stored === 'string' && stored.includes('"fail":true')) throw new Error('blob store offline');
      return real(stored);
    });
    try {
      const { doc } = await exportDoc({ categories: ['memories', 'workflowRuns', 'outputs'] });
      expect(doc.complete).toBe(false);
      expect(doc.error).toBe('blob store offline');
      expect(doc.memories).toHaveLength(3);
      // The parent that was mid-write is closed with the children it got to.
      expect(doc.workflowRuns[0].nodeExecutions.map((n) => n.id)).toEqual(['n1']);
      expect(doc.outputs).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('stops reading once the client goes away', async () => {
    const res = fakeResponse();
    const originalWrite = res.write.bind(res);
    let writes = 0;
    res.write = (chunk) => {
      writes += 1;
      if (writes === 3) res.emit('close');
      return originalWrite(chunk);
    };
    const result = await Service.streamExport({ userId: A, options: Service.normalizeExportOptions({}), res });
    expect(result.complete).toBe(false);
    expect(writes).toBeLessThan(6);
  });
});

describe('DataExportService — options', () => {
  it('defaults to every category in canonical order', () => {
    expect(Service.normalizeExportOptions({}).categories).toEqual(Service.EXPORT_CATEGORIES.map((c) => c.id));
    expect(Service.normalizeExportOptions({ categories: ['outputs', 'memories'] }).categories).toEqual(['memories', 'outputs']);
  });

  it.each([
    [{ categories: [] }, /at least one/],
    [{ categories: ['memories', 'passwords'] }, /Unknown export category: passwords/],
    [{ since: '09/01/2026' }, /since must be a date/],
    [{ until: '2026-13-45' }, /until must be a date/],
    [{ since: '2026-09-05', until: '2026-09-01' }, /since must not be after until/],
  ])('rejects %j', (options, message) => {
    expect(() => Service.normalizeExportOptions(options)).toThrow(message);
    try { Service.normalizeExportOptions(options); } catch (err) { expect(err.status).toBe(400); }
  });
});

describe('DataExportService — tickets', () => {
  it('is single use and bound to the minting user', () => {
    const options = Service.normalizeExportOptions({});
    const { token } = Service.createExportTicket(A, options);
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(Service.consumeExportTicket(token)).toEqual({ userId: A, options });
    expect(Service.consumeExportTicket(token)).toBeNull();
  });

  it('expires after a minute', () => {
    const now = Date.now();
    const { token } = Service.createExportTicket(A, Service.normalizeExportOptions({}), now);
    expect(Service.consumeExportTicket(token, now + 60_001)).toBeNull();
  });

  it('rejects unknown and malformed tickets', () => {
    expect(Service.consumeExportTicket('nope')).toBeNull();
    expect(Service.consumeExportTicket('')).toBeNull();
    expect(Service.consumeExportTicket(undefined)).toBeNull();
  });
});

describe('MemoryRoutes — export endpoints', () => {
  let server;
  let base;

  beforeEach(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/memory', MemoryRoutes);
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}/api/memory`;
    return () => new Promise((r) => server.close(r));
  });

  it('lists categories with counts for the caller only', async () => {
    const res = await fetch(`${base}/export/categories`, { headers: { 'x-test-user': A } });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.categories.find((c) => c.id === 'memories').count).toBe(3);
    expect(body.categories.map((c) => c.id)).toEqual(Service.EXPORT_CATEGORIES.map((c) => c.id));
  });

  it('requires auth to mint a ticket, validates the body, and downloads once, only as the same user', async () => {
    expect((await fetch(`${base}/export`, { method: 'POST' })).status).toBe(401);

    const bad = await fetch(`${base}/export`, {
      method: 'POST', headers: { 'x-test-user': A, 'content-type': 'application/json' }, body: JSON.stringify({ categories: ['nope'] }),
    });
    expect(bad.status).toBe(400);

    const minted = await (await fetch(`${base}/export`, {
      method: 'POST', headers: { 'x-test-user': A, 'content-type': 'application/json' }, body: JSON.stringify({ categories: ['memories'] }),
    })).json();
    expect(minted.success).toBe(true);
    expect(minted.downloadUrl).toBe(`/api/memory/export/download/${minted.ticket}`);
    expect(minted.filename).toMatch(/^agnt-export-memories-/);

    // A ticket alone is not enough: the download must also be signed in...
    expect((await fetch(`${base}/export/download/${minted.ticket}`)).status).toBe(401);
    // ...as the SAME user. Someone else holding the ticket gets nothing, and it is spent.
    const minted2 = await (await fetch(`${base}/export`, {
      method: 'POST', headers: { 'x-test-user': A, 'content-type': 'application/json' }, body: JSON.stringify({ categories: ['memories'] }),
    })).json();
    expect((await fetch(`${base}/export/download/${minted2.ticket}`, { headers: { 'x-test-user': B } })).status).toBe(404);
    expect((await fetch(`${base}/export/download/${minted2.ticket}`, { headers: { 'x-test-user': A } })).status).toBe(404);

    const download = await fetch(`${base}/export/download/${minted.ticket}`, { headers: { 'x-test-user': A } });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
    const doc = JSON.parse(await download.text());
    expect(doc.complete).toBe(true);
    expect(doc.memories).toHaveLength(3);

    const replay = await fetch(`${base}/export/download/${minted.ticket}`, { headers: { 'x-test-user': A } });
    expect(replay.status).toBe(404);
  });
});
