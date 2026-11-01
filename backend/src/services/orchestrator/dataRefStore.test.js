/**
 * Offloaded tool data survives a backend restart (bravo, 2026-10-31: a data set offloaded earlier in a
 * chat was gone after the backend restarted mid-chat; query_data answered "not found" though the
 * {{DATA_REF}} was still in the history). Real (per-run) database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import db, { dbReady } from '../../models/database/index.js';
import { persistDataRef, loadDataRef, listDataRefs, pruneDataRefs, MAX_REF_BYTES, MAX_CONVERSATION_BYTES } from './dataRefStore.js';
import { TOOLS } from './tools.js';

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, (err) => (err ? reject(err) : resolve())));
const conversation = () => `conv-${randomUUID()}`;
const USER = 'data-ref-owner';
const OTHER = 'data-ref-other';

beforeAll(async () => { await dbReady; });

describe('offloaded data store', { timeout: 30000 }, () => {
  it('a restarted backend (empty memory) still answers query_data from the store', async () => {
    const conversationId = conversation();
    const data = JSON.stringify(Array.from({ length: 300 }, (_, i) => ({ id: i, email: `user${i}@example.com` })));
    expect(await persistDataRef(conversationId, USER, 'data-call_x-1-0', data, { type: 'json_array', size: data.length, lineCount: 1 })).toBe(true);

    const freshContext = { conversationId, userId: USER, preservedContent: {}, dataRefSummaries: {} };
    const listed = JSON.parse(await TOOLS.query_data.execute({ operation: 'list' }, null, freshContext));
    expect(listed.refs.map((r) => r.dataId)).toContain('data-call_x-1-0');
    const found = JSON.parse(await TOOLS.query_data.execute({ operation: 'search', dataId: 'data-call_x-1-0', query: 'user42@example.com' }, null, freshContext));
    expect(found.success).toBe(true);
    expect(JSON.stringify(found)).toContain('user42@example.com');
    expect(freshContext.preservedContent['data-call_x-1-0']).toBe(data);
  });

  it('a ref is never readable through another user, or another conversation', async () => {
    const conversationId = conversation();
    await persistDataRef(conversationId, USER, 'data-private-1-0', 'secret rows');
    expect(await loadDataRef(conversationId, OTHER, 'data-private-1-0')).toBeNull();
    expect(await loadDataRef(conversation(), USER, 'data-private-1-0')).toBeNull();
    expect(await listDataRefs(conversationId, OTHER)).toEqual([]);
  });

  it('nothing is stored for an optimistic client id, or a value over the cap', async () => {
    expect(await persistDataRef('temp-123', USER, 'data-a-1-0', 'x')).toBe(false);
    expect(await persistDataRef(conversation(), USER, 'data-a-1-0', 'x'.repeat(MAX_REF_BYTES + 1))).toBe(false);
  });

  it('a conversation keeps at most MAX_CONVERSATION_BYTES, dropping its oldest refs first', async () => {
    const conversationId = conversation();
    const chunk = 'y'.repeat(MAX_REF_BYTES);
    const count = Math.floor(MAX_CONVERSATION_BYTES / MAX_REF_BYTES) + 1;
    for (let i = 0; i < count; i += 1) expect(await persistDataRef(conversationId, USER, `data-big-${i}-0`, chunk)).toBe(true);
    const kept = (await listDataRefs(conversationId, USER)).map((r) => r.dataId);
    expect(kept).not.toContain('data-big-0-0');
    expect(kept).toContain(`data-big-${count - 1}-0`);
    expect(kept.length).toBe(count - 1);
  });

  it('expired refs are pruned', async () => {
    const conversationId = conversation();
    await persistDataRef(conversationId, USER, 'data-old-1-0', 'old');
    await run('UPDATE conversation_data_refs SET created_at = ? WHERE conversation_id = ?', [new Date(Date.now() - 48 * 3600 * 1000).toISOString(), conversationId]);
    expect(await pruneDataRefs()).toBeGreaterThanOrEqual(1);
    expect(await loadDataRef(conversationId, USER, 'data-old-1-0')).toBeNull();
  });
});
