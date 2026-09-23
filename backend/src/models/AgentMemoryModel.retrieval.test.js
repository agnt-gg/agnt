import { describe, it, expect, vi, afterAll } from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'node:fs';
import vm from 'node:vm';
const database = new sqlite3.Database(':memory:');
vi.mock('./database/index.js', () => ({ default: database }));
const run = (sql, params = []) => new Promise((resolve, reject) => database.run(sql, params, function(error) { error ? reject(error) : resolve(this); }));
const all = (sql, params = []) => new Promise((resolve, reject) => database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows)));
const schema = fs.readFileSync(new URL('./database/index.js', import.meta.url), 'utf8');
for (const table of ['agent_memory']) {
  const ddl = schema.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + table + ' \\([\\s\\S]*?\\)`'))[0].slice(0, -1);
  await run(ddl);
}
await run('CREATE TABLE agents(id TEXT PRIMARY KEY, name TEXT, status TEXT, created_by TEXT)');
await run('ALTER TABLE agent_memory ADD COLUMN content_shape TEXT');
await run('ALTER TABLE agent_memory ADD COLUMN occurrence_count INTEGER DEFAULT 1');
await run('ALTER TABLE agent_memory ADD COLUMN last_seen_at TEXT');
// FTS uses the production column contract and tokenizer; no application DB import.
await run('CREATE VIRTUAL TABLE agent_memory_fts USING fts5(doc_id UNINDEXED, content, user_id UNINDEXED, agent_id UNINDEXED, memory_type UNINDEXED, created_at UNINDEXED, updated_at UNINDEXED, tokenize="unicode61")');
await run(`CREATE TRIGGER memory_insert AFTER INSERT ON agent_memory BEGIN INSERT INTO agent_memory_fts(doc_id, content, user_id, agent_id, memory_type, created_at, updated_at) VALUES(new.id, new.content, new.user_id, new.agent_id, new.memory_type, new.created_at, new.updated_at); END`);
const { default: Memory } = await import('./AgentMemoryModel.js');
const { prepareMemoryWrite } = await import('../utils/memoryLesson.js');
const insert = (id, content, user = 'u1', agent = 'orchestrator', type = 'context', date = '2026-09-01') => run('INSERT INTO agent_memory(id,content,user_id,agent_id,memory_type,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', [id,content,user,agent,type,date,date]);
await insert('old', 'Inspect packaged native architecture before declaring Intel binary compatibility.', 'u1', 'orchestrator', 'pattern', '2025-01-01');
for (let i = 0; i < 250; i++) await insert(`new-${i}`, 'Unrelated garden observations', 'u1', 'orchestrator', i < 200 ? 'context' : 'pattern');
// Execute the immutable pre-change model against this SAME fixture as the baseline oracle.
// Frozen verbatim retrieval algorithm from 3090bf66. Self-contained for shallow CI clones.
const baselineSource = "class Baseline {\n  static async findRelevant(agentId, userId, query, limit = 10) {\n    // Type tiers — defined once at the top of the function and reused for\n    // both candidate-pool quotas and downstream score weighting.\n    //\n    // User-set: saved at the user's direction (or `save_agent_memory` from\n    //   chat). These are authoritative and should always have a floor in\n    //   the candidate window.\n    // Auto-extracted: emitted by the insight system (pattern/tool_insight/\n    //   workflow_insight). Useful but noisier; with tens of thousands of\n    //   rows they will otherwise drown out user-set memories.\n    const USER_SET_TYPE_LIST = ['fact', 'preference', 'correction', 'context', 'prompt_guidance'];\n    const AUTO_TYPE_LIST = ['pattern', 'tool_insight', 'workflow_insight'];\n    const USER_SET_TYPES = new Set(USER_SET_TYPE_LIST);\n\n    let candidates;\n    if (agentId && agentId !== 'orchestrator') {\n      const [agentUser, agentAuto, globalUser, globalAuto] = await Promise.all([\n        this.findByAgentId(agentId, { limit: 120, memoryTypes: USER_SET_TYPE_LIST }),\n        this.findByAgentId(agentId, { limit: 30, memoryTypes: AUTO_TYPE_LIST }),\n        this.findByAgentId('orchestrator', { limit: 40, memoryTypes: USER_SET_TYPE_LIST }),\n        this.findByAgentId('orchestrator', { limit: 10, memoryTypes: AUTO_TYPE_LIST }),\n      ]);\n      candidates = [...agentUser, ...agentAuto, ...globalUser, ...globalAuto];\n    } else {\n      const [userSet, autoExtracted] = await Promise.all([\n        this.findByUserId(userId, { limit: 150, sort: 'relevance', memoryTypes: USER_SET_TYPE_LIST }),\n        this.findByUserId(userId, { limit: 50, sort: 'relevance', memoryTypes: AUTO_TYPE_LIST }),\n      ]);\n      candidates = [...userSet, ...autoExtracted];\n    }\n\n    if (candidates.length === 0) return [];\n\n    // Extract keywords from query (3+ char words, lowercased, deduplicated)\n    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'some', 'them', 'than', 'its', 'over', 'such', 'that', 'this', 'with', 'will', 'each', 'make', 'like', 'from', 'just', 'into', 'what', 'when', 'how', 'where', 'which', 'their', 'would', 'there', 'about', 'could', 'other', 'after', 'these', 'also', 'should', 'please', 'want', 'need', 'help', 'does', 'don']);\n    const keywords = [...new Set(\n      query.toLowerCase()\n        .replace(/[^a-z0-9\\s]/g, ' ')\n        .split(/\\s+/)\n        .filter(w => w.length >= 3 && !stopWords.has(w))\n    )];\n\n    if (keywords.length === 0) {\n      // No meaningful keywords — return highest relevance memories\n      return candidates.slice(0, limit);\n    }\n\n    // Type priority: memories saved at the user's direction outrank memories\n    // auto-extracted by the insight pipeline. Same tier split as the\n    // candidate-pool quotas above; reused for score weighting here.\n    const typeWeight = (mem) => USER_SET_TYPES.has(mem.memory_type) ? 1.0 : 0.4;\n\n    // Score each memory by keyword overlap, relevance, and type tier.\n    const scored = candidates.map(mem => {\n      const contentLower = mem.content.toLowerCase();\n      let matchCount = 0;\n      for (const kw of keywords) {\n        if (contentLower.includes(kw)) matchCount++;\n      }\n      const matchRatio = matchCount / keywords.length;\n      const base = (matchRatio * 0.7) + ((mem.relevance_score || 1.0) / 2.0 * 0.3);\n      const score = base * typeWeight(mem);\n      return { ...mem, _matchCount: matchCount, _score: score };\n    });\n\n    // Sort by score, then user-set tier, then stored relevance.\n    scored.sort((a, b) =>\n      b._score - a._score ||\n      typeWeight(b) - typeWeight(a) ||\n      b.relevance_score - a.relevance_score\n    );\n\n    // Take top matches, but ensure we include at least some high-signal\n    // user-set memories even if they don't keyword-match (facts, corrections,\n    // and preferences are always relevant background context).\n    const matched = scored.filter(m => m._matchCount > 0).slice(0, limit);\n    const ALWAYS_RELEVANT_TYPES = new Set(['fact', 'correction', 'preference']);\n    const alwaysRelevant = candidates\n      .filter(m => ALWAYS_RELEVANT_TYPES.has(m.memory_type) && !matched.some(mm => mm.id === m.id))\n      .slice(0, Math.max(2, limit - matched.length));\n\n    const result = [...matched, ...alwaysRelevant].slice(0, limit);\n\n    // Increment access counts for returned memories\n    for (const mem of result) {\n      this.incrementAccess(mem.id).catch(() => {});\n    }\n\n    return result;\n  }\n\n}\nglobalThis.Memory=Baseline;";
const sandbox = { console };
vm.createContext(sandbox); vm.runInContext(baselineSource, sandbox);
sandbox.Memory.findByUserId = (userId, { limit, memoryTypes }) => all(
  `SELECT * FROM agent_memory WHERE user_id=? AND memory_type IN (${memoryTypes.map(() => '?').join(',')})
   ORDER BY relevance_score DESC, updated_at DESC, id ASC LIMIT ?`, [userId, ...memoryTypes, limit]);
sandbox.Memory.incrementAccess = () => Promise.resolve(); // Do not let the oracle mutate the comparison fixture.
afterAll(() => new Promise(resolve => database.close(resolve)));
describe('full-index task retrieval versus current baseline', () => {
  it('finds the old lesson the baseline shortlist excludes', async () => {
    const query = 'Intel packaged native architecture';
    const before = await sandbox.Memory.findRelevant(null, 'u1', query, 5);
    const after = await Memory.findRelevant(null, 'u1', query, 5);
    expect(before.map(row => row.id)).not.toContain('old');
    expect(after.map(row => row.id)).toContain('old');
  });
  it('returns nothing for filler or unmatched text, unlike baseline fallback', async () => {
    expect(await Memory.findRelevant(null, 'u1', 'please go ahead and do it', 5)).toEqual([]);
    expect((await sandbox.Memory.findRelevant(null, 'u1', 'please', 5)).length).toBeGreaterThan(0);
    expect(await Memory.findRelevant(null, 'u1', 'qzxunmatched', 5)).toEqual([]);
  });
  it('enforces user and agent scope before limiting candidates', async () => {
    for (let i = 0; i < 60; i++) await insert('foreign' + i, 'scopefixture', 'u2');
    await insert('own', 'scopefixture', 'u1', 'a1');
    await insert('global', 'scopefixture', 'u1');
    await insert('other-agent', 'scopefixture', 'u1', 'a2');
    const ids = (await Memory.searchRelevant({ userId: 'u1', agentId: 'a1', query: 'scopefixture' })).map(row => row.id);
    expect(ids.sort()).toEqual(['global', 'own']);
    expect((await Memory.searchRelevant({ userId: 'u1', query: 'scopefixture' })).map(row => row.id).sort()).toEqual(['global', 'other-agent', 'own']);
  });
  it('fetches old full entries and rejects cross-user exact IDs', async () => {
    expect((await Memory.findAuthorized({ userId: 'u1', memoryId: 'old' }))[0].content).toContain('Intel');
    expect(await Memory.findAuthorized({ userId: 'u2', memoryId: 'old' })).toEqual([]);
    await expect(Memory.searchRelevant({ query: 'Intel' })).rejects.toThrow('userId');
  });
  it('preserves compound identifiers and numbers without FTS syntax errors', async () => {
    await insert('gba', 'Build gba-recomp using gcc-12');
    for (const query of ['gba-recomp', 'gcc-12', '"gba-recomp"', 'gba-recomp;']) expect((await Memory.searchRelevant({ userId: 'u1', query })).map(row => row.id)).toContain('gba');
    for (const query of ['OR NOT : *', '"', 'AND', 'id:hello']) await Memory.searchRelevant({ userId: 'u1', query });
    expect(Memory.queryTerms('not gcc-12')).toEqual(['not*', '"gcc 12"*']);
    expect(Memory.queryTerms(Array.from({length:100}, (_,i)=>'term'+i).join(' '))).toHaveLength(16);
  });
  it('searches without modifying access, relevance or timestamps', async () => {
    const before = await all('SELECT * FROM agent_memory WHERE id = ?', ['old']);
    await Memory.searchRelevant({ userId: 'u1', query: 'Intel' });
    await Memory.searchRelevant({ userId: 'u1', query: 'Intel' });
    expect(await all('SELECT * FROM agent_memory WHERE id = ?', ['old'])).toEqual(before);
  });
  it('handles exact concurrent lesson saves and keeps opposing lessons', async () => {
    const lesson = { when: 'native release', action: 'Inspect architecture', boundary: 'Not launch proof', evidence: 'Different packaged CPU' };
    const write = prepareMemoryWrite({ lesson }, { userId:'u1', executionId:'run1' });
    const ids = await Promise.all(Array.from({length:20}, () => Memory.create(write)));
    expect(new Set(ids).size).toBe(1);
    expect(await all('SELECT COUNT(*) count FROM agent_memory WHERE id = ?', [ids[0]])).toEqual([{count:1}]);
    expect(await Memory.create(prepareMemoryWrite({ lesson }, {userId:'u1', executionId:'run2'}))).toBe(ids[0]);
    const opposed = prepareMemoryWrite({ lesson:{...lesson, action:'Do not inspect architecture'} }, {userId:'u1', executionId:'run3'});
    expect(await Memory.create(opposed)).not.toBe(ids[0]);
    expect((await Memory.findAuthorized({userId:'u1',memoryId:ids[0]}))[0].content).toContain('Source execution: run1');
  });
  it('propagates index errors rather than inventing fallback memories', async () => {
    await run('ALTER TABLE agent_memory_fts RENAME TO held_memory_fts');
    try { await expect(Memory.searchRelevant({userId:'u1',query:'Intel'})).rejects.toThrow(); }
    finally { await run('ALTER TABLE held_memory_fts RENAME TO agent_memory_fts'); }
  });
});
