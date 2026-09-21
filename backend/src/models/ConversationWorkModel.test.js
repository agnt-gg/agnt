import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { ConversationWorkModel } from './ConversationWorkModel.js';
let database, model, work;
beforeEach(async () => {
  database = new sqlite3.Database(':memory:'); model = new ConversationWorkModel(database);
  await model.initialize(); work = await model.create({conversationId: 'conversation', ownerId: 'owner', objective: 'Finish all five requirements', now: 0});
});
afterEach(() => new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve())));
describe('durable conversation ownership', () => {
  it('only one competing attempt can claim work', async () => {
    const claims = await Promise.all([model.claim(work.id, 'owner', {now: 1}), model.claim(work.id, 'owner', {now: 1})]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
  it('cannot claim another owner work', async () => expect(await model.claim(work.id, 'stranger')).toBeNull());
  it('expired ownership cannot checkpoint after takeover', async () => {
    const first = await model.claim(work.id, 'owner', {now: 1, leaseMs: 10});
    const second = await model.claim(work.id, 'owner', {now: 12});
    expect(second.generation).toBe(2);
    expect(await model.checkpoint(first, {status: 'succeeded', checkpoint: {}, reason: 'stale', now: 13})).toBe(false);
  });
  it('Stop prevents late completion and reclaim', async () => {
    const claim = await model.claim(work.id, 'owner', {now: 1});
    await model.pause(work.id, 'owner', 2);
    expect(await model.checkpoint(claim, {status: 'succeeded', checkpoint: {}, reason: 'late', now: 3})).toBe(false);
    expect(await model.claim(work.id, 'owner', {now: 999999})).toBeNull();
    expect(await model.resume(work.id, 'owner', 4)).toBe(true);
    expect(await model.claim(work.id, 'owner', {now: 5})).not.toBeNull();
  });
  it('persists next wake and checkpoint atomically', async () => {
    const claim = await model.claim(work.id, 'owner', {now: 1});
    expect(await model.checkpoint(claim, {status: 'retry_wait', checkpoint: {remaining: ['one']}, reason: 'provider_retry', nextWake: 100, now: 2})).toBe(true);
    const restored = new ConversationWorkModel(database);
    expect(JSON.parse((await restored.find(work.id, 'owner')).checkpoint_json)).toEqual({remaining: ['one']});
    expect(await restored.claim(work.id, 'owner', {now: 99})).toBeNull();
    expect(await restored.claim(work.id, 'owner', {now: 100})).not.toBeNull();
  });
  it('prevents duplicate active conversation objectives', async () => {
    await expect(model.create({conversationId: 'conversation', ownerId: 'owner', objective: 'duplicate'})).rejects.toThrow();
  });
  it('a paused lease cannot be renewed', async () => {
    const claim = await model.claim(work.id, 'owner', {now: 1});
    await model.pause(work.id, 'owner', 2);
    expect(await model.renew(claim, {now: 3})).toBe(false);
  });
});
