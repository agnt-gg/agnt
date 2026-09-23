import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import zlib from 'zlib';
import { dbReady, dbPath } from '../models/database/index.js';
import { createDataRouter, openJobDatabase } from './DataRoutes.js';

let server, base;
const stopWorkflow = vi.fn(async () => {});
beforeAll(async () => {
  await dbReady;
  const app = express();
  app.use('/api/data', createDataRouter({
    authenticate: (req, res, next) => { const user = req.headers['x-test-user']; if (!user) return res.status(401).json({ error: 'auth' }); req.user = { userId: user }; next(); },
    openDb: () => openJobDatabase(dbPath),
    stopWorkflow,
  }));
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}/api/data`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));

const call = (path, { user = 'dr-alice', method = 'GET', body, json = true } = {}) =>
  fetch(base + path, { method, headers: { ...(user ? { 'x-test-user': user } : {}), ...(json && body ? { 'content-type': 'application/json' } : {}) }, body: json && body ? JSON.stringify(body) : body })
    .then(async r => ({ status: r.status, body: await r.json() }));

const BACKUP = [
  '{"format":"agnt-data-export","version":1,"exportedAt":"2026-09-01T00:00:00.000Z","filters":{"since":null,"until":null},"categories":["memories","somethingNew"],',
  '"memories":[',
  '{"id":"dr-mem-1","agent_id":"annie","user_id":"someone-else","memory_type":"fact","content":"likes tea","created_at":"2026-09-01 10:00:00"}',
  ']',
  ',',
  '"somethingNew":[',
  '{"id":"x"}',
  '],',
  '"counts":{"memories":1,"somethingNew":1},',
  '"complete":true',
  '}',
].join('\n');

describe('restore over HTTP', () => {
  it('needs a sign-in, rejects empty and non-backup uploads', async () => {
    expect((await call('/restore', { user: null, method: 'POST', body: 'x', json: false })).status).toBe(401);
    expect((await call('/restore', { method: 'POST', body: '', json: false })).body.error).toMatch(/Choose a backup/);
    expect((await call('/restore', { method: 'POST', body: '{"hello":1}\n', json: false })).body.error).toBe('This is not an AGNT backup file.');
  });

  it('summarises a gzipped upload, restores it as the uploader, and keeps it private to them', async () => {
    const uploaded = await call('/restore', { method: 'POST', body: zlib.gzipSync(BACKUP), json: false });
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.summary.categories.map(c => [c.id, c.count, c.restorable])).toEqual([['memories', 1, true], ['somethingNew', 1, false]]);
    const id = uploaded.body.id;

    // Someone else cannot see, start or delete it.
    expect((await call(`/restore/${id}`, { user: 'dr-bob' })).status).toBe(404);
    expect((await call(`/restore/${id}/start`, { user: 'dr-bob', method: 'POST', body: { categories: ['memories'] } })).status).toBe(404);
    // Only categories this version understands can be chosen.
    expect((await call(`/restore/${id}/start`, { method: 'POST', body: { categories: ['somethingNew'] } })).status).toBe(400);

    expect((await call(`/restore/${id}/start`, { method: 'POST', body: { categories: ['memories'] } })).body.status).toBe('running');
    let job;
    for (let i = 0; i < 50; i += 1) {
      job = (await call(`/restore/${id}`)).body;
      if (job.status !== 'running') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(job.status).toBe('done');
    expect(job.result.results.memories).toEqual({ added: 1, existing: 0, skipped: 0 });

    // Restored as the uploader, never as whoever the file named.
    const db = await openJobDatabase(dbPath);
    const row = await new Promise(resolve => db.get("SELECT user_id FROM agent_memory WHERE id='dr-mem-1'", (e, r) => resolve(r)));
    await new Promise(resolve => db.close(resolve));
    expect(row.user_id).toBe('dr-alice');

    expect((await call(`/restore/${id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/restore/${id}`)).status).toBe(404);
  });
});

describe('reset over HTTP', () => {
  it('lists what each option would remove for the caller', async () => {
    const { body } = await call('/reset');
    expect(body.groups.map(g => g.id)).toEqual(['chats', 'history', 'memory', 'work', 'preferences', 'connections']);
    expect(body.groups.find(g => g.id === 'memory').count).toBeGreaterThanOrEqual(1);
    expect(body.groups.find(g => g.id === 'connections').danger).toBe(true);
  });

  it('does nothing without the typed confirmation or with an unknown option', async () => {
    expect((await call('/reset', { method: 'POST', body: { groups: ['memory'] } })).body.error).toMatch(/Type RESET/);
    expect((await call('/reset', { method: 'POST', body: { groups: ['memory'], confirm: 'reset' } })).status).toBe(400);
    expect((await call('/reset', { method: 'POST', body: { groups: ['users'], confirm: 'RESET' } })).status).toBe(400);
    expect((await call('/reset', { method: 'POST', body: { groups: [], confirm: 'RESET' } })).status).toBe(400);
  });

  it('removes only the caller\'s rows in the chosen groups', async () => {
    const reset = await call('/reset', { method: 'POST', body: { groups: ['memory'], confirm: 'RESET' } });
    expect(reset.status).toBe(200);
    expect(reset.body.removed.memory).toBeGreaterThanOrEqual(1);
    const after = (await call('/reset')).body.groups.find(g => g.id === 'memory');
    expect(after.count).toBe(0);
  });
});
