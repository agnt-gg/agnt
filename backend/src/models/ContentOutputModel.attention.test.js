/**
 * Attention columns on content_outputs: last_read_at + archived_at.
 *
 * Unread is DERIVED (updated_at > last_read_at, or last_read_at NULL), never
 * stored — so the invariants that matter here are the write-shape ones:
 *
 *   1. setReadState(true)/setArchived must NOT touch updated_at. Reading is
 *      not a change; bumping updated_at on read would immediately un-read the
 *      read, and bumping it on archive would teleport the conversation to the
 *      top of the recency sort when unarchived.
 *      setReadState(FALSE) is the one deliberate exception — marking a
 *      conversation unread IS activity, so it moves updated_at with the
 *      watermark. See the "mark-as-unread is activity" block at the bottom.
 *   2. Both writes are ownership-scoped (WHERE user_id) and report
 *      changes: 0 for a foreign or missing row so the route can 404.
 *   3. The list endpoint's column set includes both new columns — the
 *      frontend derives everything from the list payload alone.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let ContentOutputModel;
let TMP;
const savedEnv = {};

const USER = 'user-attention-1';
const OTHER_USER = 'user-attention-2';
const OUT = 'out-attention-1';
const BULK_A = 'out-attention-bulk-a';
const BULK_B = 'out-attention-bulk-b';

/**
 * The predicate unread is DERIVED from, mirrored from
 * frontend/src/utils/conversationAttention.js. A row with NO watermark is not
 * unread — absence of a watermark is not evidence of something unseen. String
 * comparison is valid because every value here is SQLite's fixed-width
 * "YYYY-MM-DD HH:MM:SS".
 */
function isUnreadRow(row) {
  return !row.archived_at && row.last_read_at !== null && row.updated_at > row.last_read_at;
}

function getRow(id) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM content_outputs WHERE id = ?', [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * Backdate a row directly. These columns are second-resolution, so proving a
 * write MOVED updated_at otherwise means sleeping 1.1s per assertion; starting
 * from an unambiguously old value makes the same claim instantly and more
 * strictly.
 */
function setUpdatedAt(id, value) {
  return new Promise((resolve, reject) => {
    db.run('UPDATE content_outputs SET updated_at = ? WHERE id = ?', [value, id], (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-attention-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  // Pre-create an empty agnt.db: the bootstrap treats "AGNT_HOME set but no
  // agnt.db" as a fresh install that should inherit an orphaned database, and
  // would try to copy the developer's real database into temp.
  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  ContentOutputModel = (await import('./ContentOutputModel.js')).default;

  // FK enforcement is on — content_outputs.user_id references users(id).
  for (const uid of [USER, OTHER_USER]) {
    await new Promise((resolve, reject) => {
      db.run('INSERT INTO users (id, email) VALUES (?, ?)', [uid, `${uid}@test.local`], (err) => (err ? reject(err) : resolve()));
    });
  }

  await ContentOutputModel.createOrUpdate(
    OUT, USER, null, null, '{"messages":[]}', false, 'conversation', 'conv-attn-1', 'Attention test'
  );
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('content_outputs attention columns', () => {
  it('fresh schema has last_read_at and archived_at, both NULL on create', async () => {
    const row = await getRow(OUT);
    expect(row).toBeTruthy();
    expect(row.last_read_at).toBeNull();
    expect(row.archived_at).toBeNull();
  });

  it('a row with no watermark is NOT unread', async () => {
    // THE REPORTED BUG. Treating a missing watermark as "needs your
    // attention" put every conversation predating this column into the triage
    // rail — 1624 of 1649 on a live install.
    expect(isUnreadRow(await getRow(OUT))).toBe(false);
  });

  it('the list column set includes both columns', async () => {
    const { outputs } = await ContentOutputModel.findAllByUserId(USER);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toHaveProperty('last_read_at');
    expect(outputs[0]).toHaveProperty('archived_at');
  });

  it('setReadState(true) stamps last_read_at without touching updated_at', async () => {
    const before = await getRow(OUT);

    const result = await ContentOutputModel.setReadState(OUT, USER, true);
    expect(result.changes).toBe(1);

    const after = await getRow(OUT);
    expect(after.last_read_at).not.toBeNull();
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('setReadState(false) marks unread with a REAL watermark, never NULL', async () => {
    const result = await ContentOutputModel.setReadState(OUT, USER, false);
    expect(result.changes).toBe(1);

    const after = await getRow(OUT);
    // NULL would mean "no watermark was ever recorded", which is explicitly
    // NOT unread — so writing NULL here would make "Mark as Unread" a no-op.
    // A watermark one second before the last change says the true thing:
    // read up to just before it.
    expect(after.last_read_at).not.toBeNull();
    expect(after.last_read_at < after.updated_at).toBe(true);
    expect(isUnreadRow(after)).toBe(true);
  });

  it('setArchived(true) stamps archived_at without touching updated_at', async () => {
    const before = await getRow(OUT);

    const result = await ContentOutputModel.setArchived(OUT, USER, true);
    expect(result.changes).toBe(1);

    const after = await getRow(OUT);
    expect(after.archived_at).not.toBeNull();
    expect(after.updated_at).toBe(before.updated_at);
  });

  it('setArchived(false) restores the conversation', async () => {
    const result = await ContentOutputModel.setArchived(OUT, USER, false);
    expect(result.changes).toBe(1);

    const after = await getRow(OUT);
    expect(after.archived_at).toBeNull();
  });

  it('both writes are ownership-scoped: foreign user gets changes 0 and no write', async () => {
    const before = await getRow(OUT);

    const readResult = await ContentOutputModel.setReadState(OUT, OTHER_USER, true);
    expect(readResult.changes).toBe(0);

    const archiveResult = await ContentOutputModel.setArchived(OUT, OTHER_USER, true);
    expect(archiveResult.changes).toBe(0);

    const row = await getRow(OUT);
    expect(row.last_read_at).toBe(before.last_read_at);
    expect(row.archived_at).toBeNull();
  });

  it('missing rows report changes 0 (route 404 path)', async () => {
    expect((await ContentOutputModel.setReadState('no-such-id', USER, true)).changes).toBe(0);
    expect((await ContentOutputModel.setArchived('no-such-id', USER, true)).changes).toBe(0);
  });

  it('markAllRead skips rows that merely have no watermark', async () => {
    await ContentOutputModel.createOrUpdate(BULK_A, USER, null, null, '{}', false, 'conversation', 'conv-bulk-a', 'Bulk A');
    await ContentOutputModel.createOrUpdate(BULK_B, USER, null, null, '{}', false, 'conversation', 'conv-bulk-b', 'Bulk B');
    expect((await getRow(BULK_A)).last_read_at).toBeNull();

    // OUT is genuinely unread (marked so above); the two fresh rows are not.
    // The bulk clear reuses the exact derived-unread predicate, so `cleared`
    // is an honest count and never sweeps up quiet rows.
    const result = await ContentOutputModel.markAllRead(USER);
    expect(result.changes).toBe(1);
    expect(isUnreadRow(await getRow(OUT))).toBe(false);
    expect((await getRow(BULK_A)).last_read_at).toBeNull();
  });

  it('markAllRead clears every genuinely unread row the user owns, in one statement', async () => {
    await ContentOutputModel.setReadState(BULK_A, USER, false);
    await ContentOutputModel.setReadState(BULK_B, USER, false);

    const result = await ContentOutputModel.markAllRead(USER);
    expect(result.changes).toBe(2);

    for (const id of [OUT, BULK_A, BULK_B]) {
      const row = await getRow(id);
      expect(isUnreadRow(row)).toBe(false);
      expect(row.updated_at <= row.last_read_at).toBe(true);
    }
  });

  it('markAllRead reports 0 when nothing is unread (clearing a clear rail is not an error)', async () => {
    expect((await ContentOutputModel.markAllRead(USER)).changes).toBe(0);
  });

  it('markAllRead scoped to ids touches only those rows', async () => {
    await ContentOutputModel.setReadState(BULK_A, USER, false);
    await ContentOutputModel.setReadState(BULK_B, USER, false);

    const result = await ContentOutputModel.markAllRead(USER, [BULK_A]);
    expect(result.changes).toBe(1);
    expect(isUnreadRow(await getRow(BULK_A))).toBe(false);
    expect(isUnreadRow(await getRow(BULK_B))).toBe(true);
  });

  it('markAllRead with an EMPTY id list is a no-op, never a mass update', async () => {
    // [] means "these zero conversations". Widening it to "everything" would
    // turn a scoping bug in any caller into silent data loss of unread state.
    const result = await ContentOutputModel.markAllRead(USER, []);
    expect(result.changes).toBe(0);
    expect(isUnreadRow(await getRow(BULK_B))).toBe(true);
  });

  it('markAllRead is ownership-scoped and skips archived rows', async () => {
    expect((await ContentOutputModel.markAllRead(OTHER_USER)).changes).toBe(0);
    expect(isUnreadRow(await getRow(BULK_B))).toBe(true);

    const beforeArchive = await getRow(BULK_B);
    await ContentOutputModel.setArchived(BULK_B, USER, true);
    // Archived is never unread, so there is nothing left to clear.
    expect((await ContentOutputModel.markAllRead(USER)).changes).toBe(0);
    expect((await getRow(BULK_B)).last_read_at).toBe(beforeArchive.last_read_at);
    await ContentOutputModel.setArchived(BULK_B, USER, false);
  });

  it('markAllRead does not touch updated_at', async () => {
    const before = await getRow(BULK_B);
    // SQLite CURRENT_TIMESTAMP is second-resolution: without this wait an
    // accidental `updated_at = CURRENT_TIMESTAMP` writes the SAME string and
    // the assertion passes vacuously. Verified — the negative control for
    // that mutation was green until this line existed.
    await new Promise((r) => setTimeout(r, 1100));
    await ContentOutputModel.markAllRead(USER, [BULK_B]);
    const after = await getRow(BULK_B);
    expect(after.updated_at).toBe(before.updated_at);
    expect(isUnreadRow(after)).toBe(false);
  });

  it('a save (createOrUpdate) bumps updated_at but preserves the attention columns', async () => {
    await ContentOutputModel.setReadState(OUT, USER, true);
    const before = await getRow(OUT);

    // SQLite CURRENT_TIMESTAMP is second-resolution; force a visible bump.
    await new Promise((r) => setTimeout(r, 1100));
    await ContentOutputModel.createOrUpdate(
      OUT, USER, null, null, '{"messages":["new"]}', false, 'conversation', 'conv-attn-1', 'Attention test'
    );

    const after = await getRow(OUT);
    expect(after.last_read_at).toBe(before.last_read_at);
    expect(after.updated_at > before.updated_at).toBe(true);
    // The derived-unread relation now holds: this is what makes a background
    // save light the sidebar dot with no event bookkeeping at all.
    expect(after.updated_at > after.last_read_at).toBe(true);
  });
});

/**
 * Legacy rows — no watermark, because they predate the column — must be quiet
 * AND must not stay permanently deaf. They acquire a watermark on their first
 * write, which is what lets the population converge with no mass backfill.
 */
describe('lazy watermark acquisition (replaces the one-shot backfill)', () => {
  const LEGACY = 'out-attention-legacy';

  it('a save gives an unwatermarked row a watermark pinned BEFORE the change', async () => {
    await ContentOutputModel.createOrUpdate(
      LEGACY, USER, null, null, '{}', false, 'conversation', 'conv-legacy', 'Legacy'
    );
    const born = await getRow(LEGACY);
    expect(born.last_read_at).toBeNull();
    expect(isUnreadRow(born)).toBe(false);

    // A background agent touches it. Note there is NO wait here: the pin is
    // `updated_at - 1 second`, not `updated_at`, precisely so a save landing
    // in the same second as the previous one still reports as unread. Pinning
    // to the raw value would tie under SQLite's second resolution and `>`
    // would be false — the first change to a legacy row would vanish.
    await ContentOutputModel.createOrUpdate(
      LEGACY, USER, null, null, '{"messages":["agent"]}', false, 'conversation', 'conv-legacy', 'Legacy'
    );

    const after = await getRow(LEGACY);
    expect(after.last_read_at).not.toBeNull();
    expect(after.last_read_at < born.updated_at || after.last_read_at < after.updated_at).toBe(true);
    expect(isUnreadRow(after)).toBe(true);
  });

  it('a save never clears an existing watermark', async () => {
    await ContentOutputModel.setReadState(LEGACY, USER, true);
    const read = await getRow(LEGACY);
    expect(isUnreadRow(read)).toBe(false);

    await new Promise((r) => setTimeout(r, 1100));
    await ContentOutputModel.createOrUpdate(
      LEGACY, USER, null, null, '{"messages":["more"]}', false, 'conversation', 'conv-legacy', 'Legacy'
    );

    const after = await getRow(LEGACY);
    // COALESCE keeps the real watermark; the row goes unread because the
    // change is newer, which is the whole point of the feature.
    expect(after.last_read_at).toBe(read.last_read_at);
    expect(isUnreadRow(after)).toBe(true);
  });
});

/**
 * Rename and move bump updated_at, and both are actions the USER just took.
 * Without carrying the watermark, renaming your own conversation would light
 * its own "needs you" dot — the same class of false positive as the reported
 * bug, arriving one row at a time.
 */
describe('user-initiated writes do not flag their own conversation', () => {
  const ACTED = 'out-attention-acted';

  beforeAll(async () => {
    await ContentOutputModel.createOrUpdate(
      ACTED, USER, null, null, '{}', false, 'conversation', 'conv-acted', 'Acted'
    );
    await ContentOutputModel.setReadState(ACTED, USER, true);
    // Make sure a bump would be VISIBLE at second resolution, so these
    // assertions cannot pass vacuously.
    await new Promise((r) => setTimeout(r, 1100));
  });

  it('rename', async () => {
    expect((await ContentOutputModel.updateTitle(ACTED, USER, 'Renamed')).changes).toBe(1);
    const row = await getRow(ACTED);
    expect(row.title).toBe('Renamed');
    expect(isUnreadRow(row)).toBe(false);
  });

  it('move to group', async () => {
    await new Promise((r) => setTimeout(r, 1100));
    expect((await ContentOutputModel.moveToGroup(ACTED, USER, null)).changes).toBe(1);
    expect(isUnreadRow(await getRow(ACTED))).toBe(false);
  });

  it('bulk move to group', async () => {
    await new Promise((r) => setTimeout(r, 1100));
    expect((await ContentOutputModel.bulkMoveToGroup([ACTED], USER, null)).changes).toBe(1);
    expect(isUnreadRow(await getRow(ACTED))).toBe(false);
  });
});

/**
 * SAVES NEVER MARK READ — the email model. There used to be a `viewing`
 * flag letting the saving client stamp the read watermark atomically with
 * the write ("I'm looking at it"). Selection is not attention: a run
 * finishing in the SELECTED conversation was born read — no dot, no chime —
 * even when the user was on another screen entirely. The watermark now
 * moves only through setReadState (the read PATCH sent when the user
 * actually opens or clears a conversation).
 */
describe('saves never stamp the read watermark', () => {
  const VIEWED = 'out-attention-viewed';

  it('a fresh INSERT has no watermark — born neutral, not unread', async () => {
    await ContentOutputModel.createOrUpdate(
      VIEWED, USER, null, null, '{}', false, 'conversation', 'conv-viewed', 'Viewed'
    );
    const row = await getRow(VIEWED);
    expect(row.last_read_at).toBeNull();
    expect(isUnreadRow(row)).toBe(false);
  });

  it('a save cannot clear an unread conversation — only the read PATCH can', async () => {
    // REGRESSION GUARD for "the finished ding never fires on the selected
    // chat": mark unread, save (any save — there is no viewing arm left),
    // and the row must STAY unread until an explicit read.
    await ContentOutputModel.setReadState(VIEWED, USER, false);
    expect(isUnreadRow(await getRow(VIEWED))).toBe(true);

    await ContentOutputModel.createOrUpdate(
      VIEWED, USER, null, null, '{"messages":["seen"]}', false, 'conversation', 'conv-viewed', 'Viewed'
    );
    expect(isUnreadRow(await getRow(VIEWED))).toBe(true);

    await ContentOutputModel.setReadState(VIEWED, USER, true);
    expect(isUnreadRow(await getRow(VIEWED))).toBe(false);
  });

  it('a save to a read conversation derives unread — it changed and you have not seen it', async () => {
    await new Promise((r) => setTimeout(r, 1100));
    await ContentOutputModel.createOrUpdate(
      VIEWED, USER, null, null, '{"messages":["agent"]}', false, 'conversation', 'conv-viewed', 'Viewed'
    );
    expect(isUnreadRow(await getRow(VIEWED))).toBe(true);
  });
});

/**
 * MARK-AS-UNREAD IS ACTIVITY.
 *
 * Marking a conversation unread moves updated_at to now, because queueing it
 * for later is something the user just did to it. Writing only the watermark
 * left the row sorted by its ORIGINAL date: it claimed "unread" while sitting
 * wherever last month's activity put it, and the instant the user clicked it
 * the flag cleared and the row dropped back down — out from under the cursor
 * that had just reached it. Position and state now come from one fact.
 */
describe('mark-as-unread moves the conversation to now', () => {
  const QUEUED = 'out-attention-queued';
  const CONTROL = 'out-attention-control';
  const ANCIENT = '2025-01-02 03:04:05';

  beforeAll(async () => {
    for (const [id, conv] of [[QUEUED, 'conv-queued'], [CONTROL, 'conv-control']]) {
      await ContentOutputModel.createOrUpdate(
        id, USER, null, null, '{}', false, 'conversation', conv, 'Queued test'
      );
      await ContentOutputModel.setReadState(id, USER, true);
    }
  });

  it('moves updated_at forward off a stale date', async () => {
    await setUpdatedAt(QUEUED, ANCIENT);
    expect((await getRow(QUEUED)).updated_at).toBe(ANCIENT);

    await ContentOutputModel.setReadState(QUEUED, USER, false);

    // THE REPORTED BUG: this used to stay at ANCIENT.
    expect((await getRow(QUEUED)).updated_at > ANCIENT).toBe(true);
  });

  it('leaves the watermark exactly one second behind, so it derives as unread', async () => {
    await setUpdatedAt(QUEUED, ANCIENT);
    await ContentOutputModel.setReadState(QUEUED, USER, false);

    const after = await getRow(QUEUED);
    const gapMs = Date.parse(`${after.updated_at}Z`) - Date.parse(`${after.last_read_at}Z`);
    // Exactly one second, never zero. Both values come from one statement, and
    // SQLite evaluates CURRENT_TIMESTAMP once per statement — writing both as
    // a plain CURRENT_TIMESTAMP would tie at this resolution, making
    // `updated_at > last_read_at` false and Mark as Unread a silent no-op.
    expect(gapMs).toBe(1000);
    expect(isUnreadRow(after)).toBe(true);
  });

  it('outranks a more recently active conversation — and STAYS there once read', async () => {
    // Nathan's exact complaint, end to end. CONTROL is more recently active
    // than the stale QUEUED, so ordering by updated_at is a real claim here,
    // and both dates are fixed so nothing can tie at second resolution.
    await setUpdatedAt(CONTROL, '2026-01-01 00:00:00');
    await setUpdatedAt(QUEUED, ANCIENT);

    await ContentOutputModel.setReadState(QUEUED, USER, false);
    const control = await getRow(CONTROL);
    expect((await getRow(QUEUED)).updated_at > control.updated_at).toBe(true);

    // Reading it must not send it back down the list.
    const queuedAt = (await getRow(QUEUED)).updated_at;
    await ContentOutputModel.setReadState(QUEUED, USER, true);
    const afterRead = await getRow(QUEUED);
    expect(afterRead.updated_at).toBe(queuedAt);
    expect(afterRead.updated_at > control.updated_at).toBe(true);
    expect(isUnreadRow(afterRead)).toBe(false);
  });

  it('marking READ still never moves updated_at — the exception is one-directional', async () => {
    // Bumping on read would re-derive the row as unread the moment it was
    // read, which is the oscillation this whole area was fixed for.
    await setUpdatedAt(QUEUED, ANCIENT);
    await ContentOutputModel.setReadState(QUEUED, USER, true);
    expect((await getRow(QUEUED)).updated_at).toBe(ANCIENT);
  });

  it('a foreign user cannot move it', async () => {
    await setUpdatedAt(QUEUED, ANCIENT);
    expect((await ContentOutputModel.setReadState(QUEUED, OTHER_USER, false)).changes).toBe(0);
    expect((await getRow(QUEUED)).updated_at).toBe(ANCIENT);
  });
});

/**
 * findMetaById feeds the save response and the realtime broadcast: one row's
 * list metadata so clients merge in place instead of refetching the whole
 * history per save.
 */
describe('findMetaById', () => {
  it('returns the list column set, never the content blob', async () => {
    const meta = await ContentOutputModel.findMetaById(OUT);
    expect(meta).toBeTruthy();
    expect(meta.id).toBe(OUT);
    expect(meta).toHaveProperty('updated_at');
    expect(meta).toHaveProperty('last_read_at');
    expect(meta).toHaveProperty('archived_at');
    expect(meta).toHaveProperty('group_id');
    expect(meta).toHaveProperty('title');
    // The whole point: the ~0.5MB average content column stays home.
    expect(meta).not.toHaveProperty('content');
  });

  it('matches the shape findAllByUserId rows carry — one contract, not two', async () => {
    const meta = await ContentOutputModel.findMetaById(OUT);
    const { outputs } = await ContentOutputModel.findAllByUserId(USER);
    const listed = outputs.find((o) => o.id === OUT);
    expect(Object.keys(meta).sort()).toEqual(Object.keys(listed).sort());
  });

  it('null for a missing id', async () => {
    expect(await ContentOutputModel.findMetaById('no-such-row')).toBeNull();
  });
});
