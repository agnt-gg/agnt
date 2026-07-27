/**
 * ConversationImageBackfill tests.
 *
 * IMPORTANT: these tests must NEVER import models/database/index.js or
 * services/ImageStorage.js — the former opens the real agnt.db at import
 * time and the latter resolves the real data dir. Everything is injected:
 * an in-memory sqlite3 database and temp-dir image save/find functions.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';
import {
  extractInlineImages,
  backfillRow,
  runConversationImageBackfill,
} from './ConversationImageBackfill.js';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3');

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

// A base64 payload comfortably over the 8192-char data-URI threshold, built
// from a recognizable byte pattern so byte-verification is meaningful.
const bigImageBytes = (seed) => {
  const buf = Buffer.alloc(9000);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * seed + seed) % 251;
  return buf;
};
const dataUri = (buf, mime = 'png') => `data:image/${mime};base64,${buf.toString('base64')}`;

const SMALL_URI = `data:image/png;base64,${Buffer.from('tiny').toString('base64')}`;

function makeConversation(messageContents) {
  return JSON.stringify({
    conversationId: 'conv-1',
    messages: messageContents.map((content, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content,
      timestamp: i,
    })),
  });
}

function openDb() {
  const db = new sqlite3.Database(':memory:');
  const run = (sql, p = []) =>
    new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this.changes); }));
  const all = (sql, p = []) =>
    new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r || []))));
  const get = (sql, p = []) =>
    new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));
  return { db, run, all, get };
}

describe('ConversationImageBackfill', () => {
  let tmp; // temp root: images/ + backups/
  let h;   // db harness
  let deps;
  let logs;

  const seedRow = async (id, content, updatedAt = '2026-01-01 00:00:00') => {
    await h.run(
      `INSERT INTO content_outputs (id, user_id, content, content_type, updated_at) VALUES (?, 'u1', ?, 'conversation', ?)`,
      [id, content, updatedAt]
    );
  };

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cib-test-'));
    fs.mkdirSync(path.join(tmp, 'images'));
    h = openDb();
    await h.run(`CREATE TABLE content_outputs (
      id TEXT PRIMARY KEY, user_id TEXT, content TEXT, content_type TEXT, updated_at DATETIME
    )`);
    logs = [];
    deps = {
      dbAll: h.all,
      dbRun: h.run,
      saveBase64Image: (id, dataUrl) => {
        const m = dataUrl.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
        if (!m) return null;
        const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
        const file = path.join(tmp, 'images', `${id}.${ext}`);
        fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
        return file;
      },
      findImageFile: (id) => {
        const dir = path.join(tmp, 'images');
        const hit = fs.readdirSync(dir).find((f) => f.startsWith(`${id}.`));
        return hit ? path.join(dir, hit) : null;
      },
      backupDir: path.join(tmp, 'backups'),
      walPath: path.join(tmp, 'nonexistent-wal'),
      log: (m) => logs.push(m),
    };
  });

  afterEach(() => {
    h.db.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // extractInlineImages (pure)
  // -------------------------------------------------------------------------

  it('extracts large data URIs, leaves small ones, dedupes by content', () => {
    const big = bigImageBytes(7);
    const text = `a ${dataUri(big)} b ${SMALL_URI} c ${dataUri(big)} d`;
    const map = new Map();
    const r = extractInlineImages(text, map);
    expect(r.replaced).toBe(2);
    expect(map.size).toBe(1); // same bytes twice -> one image
    const [id] = map.keys();
    expect(id).toMatch(/^img-bf-[0-9a-f]{16}$/);
    expect(r.text).toContain(`{{IMAGE_REF:${id}}}`);
    expect(r.text).toContain(SMALL_URI); // small URI untouched
    expect(r.text).not.toContain(big.toString('base64'));
  });

  it('is a no-op on text without data URIs', () => {
    const map = new Map();
    const r = extractInlineImages('hello {{IMAGE_REF:img-x}} world', map);
    expect(r.replaced).toBe(0);
    expect(map.size).toBe(0);
    expect(r.text).toBe('hello {{IMAGE_REF:img-x}} world');
  });

  // -------------------------------------------------------------------------
  // backfillRow / full run
  // -------------------------------------------------------------------------

  it('happy path: rewrites blob, writes verified images, preserves updated_at, backs up', async () => {
    const imgA = bigImageBytes(3);
    const imgB = bigImageBytes(11);
    const content = makeConversation(['draw two things', `here: ${dataUri(imgA)} and ${dataUri(imgB, 'jpeg')}`]);
    await seedRow('row-1', content, '2026-03-15 12:00:00');

    const stats = await runConversationImageBackfill(deps);
    expect(stats.migrated).toBe(1);
    expect(stats.verifyFailed).toBe(0);
    expect(stats.error).toBe(0);

    const row = await h.get(`SELECT content, updated_at FROM content_outputs WHERE id='row-1'`);
    expect(row.updated_at).toBe('2026-03-15 12:00:00'); // ordering never shuffles
    const conv = JSON.parse(row.content);
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[1].content).toMatch(/\{\{IMAGE_REF:img-bf-[0-9a-f]{16}\}\}/);
    expect(row.content).not.toContain('base64,');

    // Every ref in the rewritten blob has a byte-identical file on disk.
    const refs = [...row.content.matchAll(/\{\{IMAGE_REF:(img-bf-[0-9a-f]{16})\}\}/g)].map((m) => m[1]);
    expect(refs.length).toBe(2);
    const filesByBytes = refs.map((id) => fs.readFileSync(deps.findImageFile(id)));
    const wanted = [imgA, imgB];
    for (const want of wanted) {
      expect(filesByBytes.some((got) => got.equals(want))).toBe(true);
    }

    // Backup of the ORIGINAL blob exists and round-trips.
    const backup = path.join(deps.backupDir, 'row-1.json.gz');
    expect(fs.existsSync(backup)).toBe(true);
    expect(zlib.gunzipSync(fs.readFileSync(backup)).toString()).toBe(content);
  });

  it('verify failure leaves the row byte-identical', async () => {
    const content = makeConversation([`x ${dataUri(bigImageBytes(5))}`]);
    await seedRow('row-v', content);

    // Sabotage: image "saves" but the bytes on disk are wrong.
    deps.saveBase64Image = (id) => {
      const file = path.join(tmp, 'images', `${id}.png`);
      fs.writeFileSync(file, Buffer.from('corrupted'));
      return file;
    };

    const stats = await runConversationImageBackfill(deps);
    expect(stats.verifyFailed).toBe(1);
    expect(stats.migrated).toBe(0);

    const row = await h.get(`SELECT content FROM content_outputs WHERE id='row-v'`);
    expect(row.content).toBe(content); // untouched, retryable next boot
  });

  it('compare-and-swap: a concurrent autosave wins, row is never clobbered', async () => {
    const content = makeConversation([`x ${dataUri(bigImageBytes(9))}`]);
    await seedRow('row-cas', content);

    // Simulate the user autosaving mid-processing: the injected image-save
    // hook fires after the row was read but before the UPDATE.
    const liveContent = makeConversation(['user kept chatting']);
    const realSave = deps.saveBase64Image;
    deps.saveBase64Image = (id, dataUrl) => {
      // synchronous UPDATE via a second statement before CAS executes
      h.db.run(`UPDATE content_outputs SET content=? WHERE id='row-cas'`, [liveContent]);
      return realSave(id, dataUrl);
    };

    const stats = await runConversationImageBackfill(deps);
    expect(stats.drift).toBe(1);
    expect(stats.migrated).toBe(0);

    const row = await h.get(`SELECT content FROM content_outputs WHERE id='row-cas'`);
    expect(row.content).toBe(liveContent); // the live write survived
  });

  it('unparseable and non-conversation-shaped blobs are skipped untouched', async () => {
    await seedRow('row-bad', 'not json at all data:image/png;base64,AAAA');
    const noMessages = JSON.stringify({ hello: 'data:image/png;base64,' + 'A'.repeat(9000) });
    await seedRow('row-shape', noMessages);

    const stats = await runConversationImageBackfill(deps);
    expect(stats.unparseable).toBe(2);
    expect(stats.migrated).toBe(0);
    expect((await h.get(`SELECT content FROM content_outputs WHERE id='row-bad'`)).content).toContain('not json');
    expect((await h.get(`SELECT content FROM content_outputs WHERE id='row-shape'`)).content).toBe(noMessages);
  });

  it('rows with only small data URIs are counted no-images and untouched', async () => {
    const content = makeConversation([`small: ${SMALL_URI}`]);
    await seedRow('row-small', content);
    const stats = await runConversationImageBackfill(deps);
    expect(stats.noImages).toBe(1);
    expect((await h.get(`SELECT content FROM content_outputs WHERE id='row-small'`)).content).toBe(content);
  });

  it('is idempotent: second run finds zero candidates', async () => {
    await seedRow('row-i', makeConversation([`x ${dataUri(bigImageBytes(2))}`]));
    const first = await runConversationImageBackfill(deps);
    expect(first.migrated).toBe(1);
    const second = await runConversationImageBackfill(deps);
    expect(second.migrated + second.noImages + second.unparseable + second.verifyFailed).toBe(0);
  });

  it('a failing row does not block later rows (cursor advances)', async () => {
    // row-a will fail verification, row-b should still migrate.
    const contentA = makeConversation([`a ${dataUri(bigImageBytes(4))}`]);
    const contentB = makeConversation([`b ${dataUri(bigImageBytes(6))}`]);
    await seedRow('row-a', contentA);
    await seedRow('row-b', contentB);

    const realSave = deps.saveBase64Image;
    let first = true;
    deps.saveBase64Image = (id, dataUrl) => {
      if (first) {
        first = false;
        const file = path.join(tmp, 'images', `${id}.png`);
        fs.writeFileSync(file, Buffer.from('wrong bytes'));
        return file;
      }
      return realSave(id, dataUrl);
    };

    const stats = await runConversationImageBackfill(deps, { batchSize: 1 });
    expect(stats.verifyFailed).toBe(1);
    expect(stats.migrated).toBe(1);
    expect((await h.get(`SELECT content FROM content_outputs WHERE id='row-a'`)).content).toBe(contentA);
    expect((await h.get(`SELECT content FROM content_outputs WHERE id='row-b'`)).content).not.toContain('base64,');
  });

  it('pauses between batches when shouldContinue returns false and resumes on a later run', async () => {
    await seedRow('row-p1', makeConversation([`x ${dataUri(bigImageBytes(13))}`]));
    await seedRow('row-p2', makeConversation([`y ${dataUri(bigImageBytes(17))}`]));

    let calls = 0;
    const stats = await runConversationImageBackfill(deps, {
      batchSize: 1,
      shouldContinue: () => Promise.resolve(++calls > 1 ? true : false),
    });
    expect(stats.paused).toBe(true);
    expect(stats.migrated).toBe(1);

    // Next "boot": remaining row completes.
    const resume = await runConversationImageBackfill(deps);
    expect(resume.migrated).toBe(1);
    const rows = await h.all(`SELECT content FROM content_outputs`);
    for (const r of rows) expect(r.content).not.toContain('base64,');
  });

  // -------------------------------------------------------------------------
  // Watermark (steady-state cost)
  // -------------------------------------------------------------------------

  const countCandidateReads = () => {
    // Wrap dbAll to count rows returned by the candidate SELECT (the query
    // that fetches content). This is the steady-state cost we bound.
    let rowsRead = 0;
    const realAll = deps.dbAll;
    deps.dbAll = async (sql, params) => {
      const rows = await realAll(sql, params);
      if (String(sql).includes("LIKE '%data:image/%'")) rowsRead += rows.length;
      return rows;
    };
    return () => rowsRead;
  };

  it('watermark: terminal no-images rows are never re-read on later runs', async () => {
    await seedRow('row-w1', makeConversation([`small: ${SMALL_URI}`]), '2026-01-01 00:00:00');
    const first = await runConversationImageBackfill(deps);
    expect(first.noImages).toBe(1);

    const getReads = countCandidateReads();
    const second = await runConversationImageBackfill(deps);
    expect(second.noImages).toBe(0);
    expect(getReads()).toBe(0); // the 390MB-per-boot class of cost, bounded at zero
  });

  it('watermark: failed rows are held back and retried on the next run', async () => {
    const content = makeConversation([`x ${dataUri(bigImageBytes(21))}`]);
    await seedRow('row-w2', content, '2026-01-01 00:00:00');

    // First run: verification fails, row untouched.
    const realSave = deps.saveBase64Image;
    deps.saveBase64Image = (id) => {
      const f = path.join(tmp, 'images', `${id}.png`);
      fs.writeFileSync(f, Buffer.from('bad'));
      return f;
    };
    const first = await runConversationImageBackfill(deps);
    expect(first.verifyFailed).toBe(1);

    // Second run with healthy saves: the row must be re-selected and migrate.
    deps.saveBase64Image = realSave;
    const second = await runConversationImageBackfill(deps);
    expect(second.migrated).toBe(1);
    const row = await h.get(`SELECT content FROM content_outputs WHERE id='row-w2'`);
    expect(row.content).not.toContain('base64,');
  });

  it('watermark: a row autosaved after a clean pass re-enters', async () => {
    await seedRow('row-w3', makeConversation(['plain text only']), '2026-01-01 00:00:00');
    await runConversationImageBackfill(deps); // clean pass, watermark advances

    // Old client autosaves a fat blob after the pass.
    const fat = makeConversation([`new: ${dataUri(bigImageBytes(23))}`]);
    await h.run(`UPDATE content_outputs SET content=?, updated_at=datetime('now','+1 minutes') WHERE id='row-w3'`, [fat]);

    const next = await runConversationImageBackfill(deps);
    expect(next.migrated).toBe(1);
  });

  it('watermark: corrupt watermark file degrades to a full rescan, never a crash', async () => {
    await seedRow('row-w4', makeConversation([`x ${dataUri(bigImageBytes(27))}`]), '2026-01-01 00:00:00');
    fs.mkdirSync(deps.backupDir, { recursive: true });
    fs.writeFileSync(path.join(deps.backupDir, '.image-backfill-watermark.json'), 'not json{{{');
    const stats = await runConversationImageBackfill(deps);
    expect(stats.migrated).toBe(1);
  });

  it('prunes backups older than 30 days, keeps fresh ones', async () => {
    fs.mkdirSync(deps.backupDir, { recursive: true });
    const oldFile = path.join(deps.backupDir, 'ancient.json.gz');
    const freshFile = path.join(deps.backupDir, 'fresh.json.gz');
    fs.writeFileSync(oldFile, zlib.gzipSync('old'));
    fs.writeFileSync(freshFile, zlib.gzipSync('new'));
    const old = (Date.now() - 40 * 24 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(oldFile, old, old);

    await runConversationImageBackfill(deps);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(freshFile)).toBe(true);
  });
});
