// Durable prompt-prefix state.
//
// Runs against a REAL in-memory SQLite database rather than a mocked driver.
// The whole point of this module is a few SQL statements — an ON CONFLICT
// upsert, an age-based prune — and a mocked `db.run` would happily accept SQL
// that SQLite rejects. Same lesson the memory-dedupe work paid for: mocks
// cannot catch a malformed query.
//
// Every test uses its OWN conversation id rather than clearing the table
// between cases. That keeps the tests independent (no ordering coupling, no
// shared mutable fixture) and means this file never needs a blanket delete.
import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sqlite3 from 'sqlite3';

const memDb = new sqlite3.Database(':memory:');
vi.mock('../../models/database/index.js', () => ({ default: memDb }));

const run = (sql, params = []) => new Promise((res, rej) => memDb.run(sql, params, function (e) { return e ? rej(e) : res(this); }));
const get = (sql, params = []) => new Promise((res, rej) => memDb.get(sql, params, (e, r) => (e ? rej(e) : res(r || null))));
const all = (sql, params = []) => new Promise((res, rej) => memDb.all(sql, params, (e, r) => (e ? rej(e) : res(r || []))));

// Mirrors the migration in models/database/index.js.
await run(`CREATE TABLE IF NOT EXISTS conversation_prompt_state (
  conversation_id TEXT PRIMARY KEY,
  user_id TEXT,
  state TEXT NOT NULL,
  state_hash TEXT,
  updated_at TEXT
)`);

const {
  saveConversationState,
  loadConversationState,
  pruneConversationState,
  serializeConversationState,
  reviveConversationState,
  PERSISTED_STATE_KEYS,
  MAX_STATE_BYTES,
  STATE_MAX_AGE_MS,
  __resetConversationStateCache,
} = await import('./conversationStateStore.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));

let seq = 0;
/** A fresh conversation id per test — isolation without teardown. */
const cid = (label) => `conv-${label}-${++seq}`;

/** A context shaped like the real one, sensitive fields and all. */
const fullContext = (over = {}) => ({
  // --- prefix-critical, must persist ---
  _frozenSkillsCatalog: '\nSKILLS CATALOG\n- a: does a\n',
  _frozenMemorySection: '\n## Memory\n- [fact] Nathan prefers green\n',
  _frozenCustomInstructions: '# IDENTITY\nI am Annie.',
  _frozenWorkspaceSection: '## Workspace\nC:/projects',
  _frozenAsyncToolsEnabled: true,
  _frozenPromptGates: ['memory_recall', 'important_guidelines'],
  _loadedToolGroups: new Set(['core', 'media']),
  _loadedToolNames: new Set(['web_search', 'generate_image']),
  _pinnedToolNames: ['discover_tools', 'web_search'],
  _toolOrder: ['discover_tools', 'web_search', 'generate_image'],
  _evictedUnits: 3,
  _estimateCalibration: 1.45,
  _residualDrift: 1.02,
  _manifestFingerprints: { system: 'abc123', tools: 'web_search,read_file' },
  activatedSkills: new Set(['hyperframes']),
  // --- must NEVER persist ---
  authToken: 'PLACEHOLDER-SENSITIVE-VALUE-1',
  messages: [{ role: 'user', content: 'x'.repeat(5000) }],
  toolSchemas: [{ type: 'function', function: { name: 'web_search' } }],
  abortSignal: { aborted: false },
  userId: 'u1',
  ...over,
});

describe('serialize / revive', () => {
  it('round-trips every persisted key', () => {
    const revived = reviveConversationState(JSON.parse(JSON.stringify(serializeConversationState(fullContext()))));
    const src = fullContext();
    for (const { key, kind } of PERSISTED_STATE_KEYS) {
      if (kind === 'set') {
        expect([...revived[key]].sort(), `${key} did not round-trip`).toEqual([...src[key]].sort());
      } else {
        expect(revived[key], `${key} did not round-trip`).toEqual(src[key]);
      }
    }
  });

  it('revives Sets AS Sets, so a disk-restored context is indistinguishable', () => {
    // If these came back as arrays, `.has(...)` would work on the in-memory
    // path and throw on the restored one — the two-paths-drift failure mode
    // this module exists to avoid.
    const revived = reviveConversationState(serializeConversationState(fullContext()));
    expect(revived._loadedToolGroups).toBeInstanceOf(Set);
    expect(revived._loadedToolNames).toBeInstanceOf(Set);
    expect(revived.activatedSkills).toBeInstanceOf(Set);
    expect(revived._loadedToolGroups.has('media')).toBe(true);
  });

  it('is an ALLOW-LIST — never carries the auth token or the transcript', () => {
    const blob = JSON.stringify(serializeConversationState(fullContext()));
    expect(blob).not.toContain('PLACEHOLDER-SENSITIVE-VALUE-1');
    expect(blob).not.toContain('authToken');
    expect(blob).not.toContain('messages');
    expect(blob).not.toContain('toolSchemas');
    expect(blob).not.toContain('abortSignal');
  });

  it('a NEW sensitive field added to the context is excluded by construction', () => {
    // The allow-list IS the safety property: a deny-list would have to be
    // updated for every future field, and would fail open if it were not.
    const blob = JSON.stringify(serializeConversationState(fullContext({
      credentialAddedByAFutureFeature: 'PLACEHOLDER-SENSITIVE-VALUE-2',
    })));
    expect(blob).not.toContain('PLACEHOLDER-SENSITIVE-VALUE-2');
  });

  it('returns null for empty / non-object input', () => {
    expect(serializeConversationState(null)).toBeNull();
    expect(serializeConversationState({})).toBeNull();
    expect(reviveConversationState(null)).toBeNull();
    expect(reviveConversationState({})).toBeNull();
  });

  it('omits empty Sets rather than storing noise', () => {
    const s = serializeConversationState({ _evictedUnits: 1, activatedSkills: new Set() });
    expect(s.activatedSkills).toBeUndefined();
    expect(s._evictedUnits).toBe(1);
  });

  it('preserves falsy-but-meaningful values', () => {
    // `_frozenAsyncToolsEnabled: false` and `_evictedUnits: 0` are real answers.
    // Dropping them would silently re-derive the toggle and reset the watermark.
    const s = serializeConversationState({ _frozenAsyncToolsEnabled: false, _evictedUnits: 0 });
    expect(s._frozenAsyncToolsEnabled).toBe(false);
    expect(s._evictedUnits).toBe(0);
    const r = reviveConversationState(s);
    expect(r._frozenAsyncToolsEnabled).toBe(false);
    expect(r._evictedUnits).toBe(0);
  });
});

describe('save / load against real SQLite', () => {
  it('persists and restores a conversation', async () => {
    const id = cid('roundtrip');
    expect(await saveConversationState(id, 'u1', fullContext())).toBe(true);
    __resetConversationStateCache();
    const loaded = await loadConversationState(id);
    expect(loaded._frozenSkillsCatalog).toBe(fullContext()._frozenSkillsCatalog);
    expect(loaded._toolOrder).toEqual(fullContext()._toolOrder);
    expect(loaded._evictedUnits).toBe(3);
  });

  it('upserts rather than duplicating (ON CONFLICT actually works)', async () => {
    const id = cid('upsert');
    await saveConversationState(id, 'u1', fullContext());
    __resetConversationStateCache();
    await saveConversationState(id, 'u1', fullContext({ _evictedUnits: 9 }));
    const rows = await all('SELECT * FROM conversation_prompt_state WHERE conversation_id = ?', [id]);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].state)._evictedUnits).toBe(9);
  });

  it('skips the write when nothing changed', async () => {
    const id = cid('skip');
    expect(await saveConversationState(id, 'u1', fullContext())).toBe(true);
    expect(await saveConversationState(id, 'u1', fullContext())).toBe(false);
  });

  it('writes again once something actually changes', async () => {
    const id = cid('changed');
    await saveConversationState(id, 'u1', fullContext());
    expect(await saveConversationState(id, 'u1', fullContext({ _evictedUnits: 4 }))).toBe(true);
  });

  it('a load seeds the skip-cache, so the next unchanged turn does not rewrite', async () => {
    const id = cid('seed');
    await saveConversationState(id, 'u1', fullContext());
    __resetConversationStateCache();
    await loadConversationState(id);
    expect(await saveConversationState(id, 'u1', fullContext())).toBe(false);
  });

  it('returns null for an unknown conversation', async () => {
    expect(await loadConversationState(cid('never-saved'))).toBeNull();
  });

  it('refuses optimistic temp- ids', async () => {
    // They are replaced once the server assigns a real id, so a row keyed on
    // one would be stranded forever.
    const id = `temp-${cid('optimistic')}`;
    expect(await saveConversationState(id, 'u1', fullContext())).toBe(false);
    expect(await all('SELECT * FROM conversation_prompt_state WHERE conversation_id = ?', [id])).toHaveLength(0);
  });

  it('refuses a missing or non-string conversation id', async () => {
    expect(await saveConversationState(null, 'u1', fullContext())).toBe(false);
    expect(await saveConversationState(42, 'u1', fullContext())).toBe(false);
    expect(await loadConversationState(null)).toBeNull();
  });

  it('stores nothing when the context has no persistable state', async () => {
    expect(await saveConversationState(cid('empty'), 'u1', { authToken: 'x', messages: [] })).toBe(false);
  });

  it('a corrupt stored blob loads as null rather than throwing', async () => {
    const id = cid('corrupt');
    await run(
      `INSERT INTO conversation_prompt_state (conversation_id, state, updated_at)
       VALUES (?, '{not json', ?)`,
      [id, new Date().toISOString()]
    );
    await expect(loadConversationState(id)).resolves.toBeNull();
  });
});

describe('bounded growth', () => {
  it('skips a state blob larger than the cap', async () => {
    const id = cid('huge');
    const huge = fullContext({ _frozenSkillsCatalog: 'x'.repeat(MAX_STATE_BYTES + 1) });
    expect(await saveConversationState(id, 'u1', huge)).toBe(false);
    expect(await all('SELECT * FROM conversation_prompt_state WHERE conversation_id = ?', [id])).toHaveLength(0);
  });

  it('a realistic state is comfortably under the cap (anti-vacuity)', async () => {
    // If a normal row were near the cap, the test above would be guarding
    // nothing and the feature would silently never persist anything.
    const id = cid('size');
    await saveConversationState(id, 'u1', fullContext());
    const row = await get('SELECT LENGTH(state) len FROM conversation_prompt_state WHERE conversation_id = ?', [id]);
    expect(row.len).toBeLessThan(MAX_STATE_BYTES / 4);
  });

  it('prunes rows older than the max age, keeping fresh ones', async () => {
    const fresh = cid('fresh');
    const stale = cid('stale');
    await saveConversationState(fresh, 'u1', fullContext());
    await run(
      `INSERT INTO conversation_prompt_state (conversation_id, user_id, state, state_hash, updated_at)
       VALUES (?, 'u1', '{"_evictedUnits":1}', 'h', ?)`,
      [stale, new Date(Date.now() - STATE_MAX_AGE_MS - 60_000).toISOString()]
    );
    await pruneConversationState();
    const survivors = (await all('SELECT conversation_id FROM conversation_prompt_state')).map((r) => r.conversation_id);
    expect(survivors).toContain(fresh);
    expect(survivors).not.toContain(stale);
  });
});

describe('THE POINT: a restored context rebuilds the identical prompt', () => {
  // Everything else here is plumbing. This is the property the feature exists
  // for: after a restart, the system block must come out BYTE-identical, or
  // the provider's cache misses and the turn pays the 2.0x write rate on the
  // whole prefix instead of the 0.1x read rate.
  //
  // Verified end-to-end against the live builder and the real database
  // separately (17/17, prompt hash fbb6473b1c5a78db across cold / in-memory /
  // disk-restored). This is the cheap always-run version of that.
  const OPTS = (ctx) => ({
    skillsCatalogSection: ctx._frozenSkillsCatalog,
    memorySection: ctx._frozenMemorySection,
    customInstructionsSection: ctx._frozenCustomInstructions,
    workspaceSection: ctx._frozenWorkspaceSection,
    asyncToolsEnabled: ctx._frozenAsyncToolsEnabled,
    residentElementIds: ctx._frozenPromptGates,
  });

  it('serialize -> revive preserves every byte the prompt is built from', async () => {
    const { buildUnifiedSystemPrompt } = await import('./system-prompts/buildUnifiedPrompt.js');
    const live = fullContext();
    const restored = reviveConversationState(JSON.parse(JSON.stringify(serializeConversationState(live))));

    const promptCtx = { normalizedProvider: 'claude-code', toolSchemas: [], latestUserMessage: 'x' };
    const before = await buildUnifiedSystemPrompt(promptCtx, OPTS(live));
    const after = await buildUnifiedSystemPrompt(promptCtx, OPTS(restored));

    expect(after).toBe(before);
  });

  it('ANTI-VACUITY: dropping a frozen section really does change the prompt', async () => {
    // If the sections contributed nothing, the assertion above would hold for
    // the wrong reason.
    const { buildUnifiedSystemPrompt } = await import('./system-prompts/buildUnifiedPrompt.js');
    const live = fullContext();
    const promptCtx = { normalizedProvider: 'claude-code', toolSchemas: [], latestUserMessage: 'x' };
    const full = await buildUnifiedSystemPrompt(promptCtx, OPTS(live));
    const lossy = await buildUnifiedSystemPrompt(promptCtx, OPTS(fullContext({ _frozenMemorySection: '' })));
    expect(lossy).not.toBe(full);
  });
});

describe('wiring contract', () => {
  const ORCH = fs.readFileSync(path.join(HERE, '..', 'OrchestratorService.js'), 'utf8');
  const SCHEMA = fs.readFileSync(path.join(HERE, '..', '..', 'models', 'database', 'index.js'), 'utf8');

  it('the table is created by the migration', () => {
    expect(SCHEMA).toMatch(/CREATE TABLE IF NOT EXISTS conversation_prompt_state\s*\(/);
    const idx = SCHEMA.search(/CREATE TABLE IF NOT EXISTS conversation_prompt_state\s*\(/);
    const body = SCHEMA.slice(idx, SCHEMA.indexOf(')', idx));
    for (const col of ['conversation_id', 'user_id', 'state', 'state_hash', 'updated_at']) {
      expect(body, `missing column ${col}`).toContain(col);
    }
  });

  it('the disk load is a FALLBACK behind the in-memory map, not a replacement', () => {
    // Reading disk first would add latency to every turn and could serve a
    // stale row while a live context sits in memory.
    expect(ORCH).toMatch(
      /const priorContext = conversationManager\.get\(conversationId\)\s*\r?\n\s*\|\| await loadConversationState\(conversationId\);/,
    );
  });

  it('both sources feed the SAME restore block', () => {
    // One restore path is what keeps the two sources from drifting. If the DB
    // branch grew its own restore code, only one of them would receive the
    // next frozen key someone adds.
    const idx = ORCH.indexOf('const priorContext = conversationManager.get(conversationId)');
    const block = ORCH.slice(idx, idx + 4000);
    expect(block.match(/if \(priorContext\) \{/g)).toHaveLength(1);
  });

  it('every key the restore block reads is on the persisted allow-list', () => {
    // The failure mode this catches: someone adds a sixth frozen section to
    // the restore block and it silently stops surviving restarts.
    const idx = ORCH.indexOf('const priorContext = conversationManager.get(conversationId)');
    const block = ORCH.slice(idx, idx + 4000);
    const referenced = new Set([...block.matchAll(/priorContext\.(_?[A-Za-z][A-Za-z0-9_]*)/g)].map((m) => m[1]));
    expect(referenced.size).toBeGreaterThan(5); // anti-vacuity
    const persisted = new Set(PERSISTED_STATE_KEYS.map((k) => k.key));
    for (const key of referenced) {
      expect(persisted.has(key), `restore reads "${key}" but it is never persisted`).toBe(true);
    }
  });

  it('state is persisted after the turn is stored in memory', () => {
    const storeIdx = ORCH.indexOf('conversationManager.store(conversationId, {');
    const saveIdx = ORCH.indexOf('saveConversationState(conversationId, userId, conversationContext)');
    expect(storeIdx).toBeGreaterThan(-1);
    expect(saveIdx).toBeGreaterThan(storeIdx);
  });

  it('the persist call cannot break or slow a turn', () => {
    const idx = ORCH.indexOf('saveConversationState(conversationId, userId, conversationContext)');
    expect(ORCH.slice(idx, idx + 200)).toMatch(/\.catch\(/);
    expect(ORCH.slice(idx - 20, idx)).not.toMatch(/await\s*$/);
  });
});

// LAST: closing the handle is irreversible, so this block runs after every
// test that needs a working database. Exercises the fail-open path for a
// genuine driver error rather than a corrupt payload.
describe('fails open when the database itself errors', () => {
  it('save, load and prune all degrade quietly', async () => {
    __resetConversationStateCache();
    await new Promise((res) => memDb.close(res));
    await expect(saveConversationState(cid('closed'), 'u1', fullContext())).resolves.toBe(false);
    await expect(loadConversationState(cid('closed'))).resolves.toBeNull();
    await expect(pruneConversationState()).resolves.toBe(0);
  });
});

afterAll(() => {
  try { memDb.close(); } catch { /* already closed by the last test */ }
});
