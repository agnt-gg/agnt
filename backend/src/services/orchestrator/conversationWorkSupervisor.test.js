import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { ConversationWorkModel } from '../../models/ConversationWorkModel.js';
import { ConversationWorkSupervisor } from './conversationWorkSupervisor.js';
let database, store, work;
beforeEach(async () => {
  database = new sqlite3.Database(':memory:'); store = new ConversationWorkModel(database); await store.initialize();
  work = await store.create({ conversationId: 'chat', ownerId: 'owner', objective: 'Finish Teams' });
});
afterEach(() => new Promise((resolve, reject) => database.close(error => error ? reject(error) : resolve())));
const evidence = {passed: true, revision: 1, validator: 'fixture', receipt: 'test-run', targetVersion: 'v1'};
const verify = async ({checkpoint}) => ({requirements: [{id: 'teams', targetVersion: 'v1', evidence: checkpoint.finished ? evidence : undefined}]});
describe('conversation supervisor', () => {
  it('unfinished final responses queue another segment without changing the objective', async () => {
    let calls = 0;
    const supervisor = new ConversationWorkSupervisor({store, verify, runSegment: async () => ({checkpoint: {finished: ++calls === 2}})});
    expect((await supervisor.run(work.id, 'owner')).status).toBe('queued');
    expect((await supervisor.run(work.id, 'owner')).status).toBe('succeeded');
    expect((await supervisor.run(work.id, 'owner')).status).toBe('not_claimed');
    expect(calls).toBe(2);
    expect((await store.find(work.id, 'owner')).objective).toBe('Finish Teams');
  });
  it('Stop fences a segment already executing', async () => {
    const supervisor = new ConversationWorkSupervisor({store, verify, runSegment: async () => {
      await supervisor.pause(work.id, 'owner'); return {checkpoint: {finished: true}};
    }});
    expect((await supervisor.run(work.id, 'owner')).status).toBe('interrupted');
    expect((await store.find(work.id, 'owner')).status).toBe('paused');
  });
  it('unclassified failures wait for reconciliation rather than replay', async () => {
    const supervisor = new ConversationWorkSupervisor({store, verify, onError: vi.fn(), runSegment: async () => {throw new Error('Outcome uncertain');}});
    expect((await supervisor.run(work.id, 'owner')).status).toBe('waiting_dependency');
    expect((await supervisor.run(work.id, 'owner')).status).toBe('not_claimed');
  });
  it('classified transient failures back off', async () => {
    const supervisor = new ConversationWorkSupervisor({store, verify, onError: vi.fn(), runSegment: async () => {throw Object.assign(new Error('Unavailable'), {retryable: true});}});
    expect((await supervisor.run(work.id, 'owner')).status).toBe('retry_wait');
    expect((await supervisor.run(work.id, 'owner')).status).toBe('not_claimed');
  });
  it('resumes checkpoints through a new supervisor instance', async () => {
    const first = new ConversationWorkSupervisor({store, verify, runSegment: async () => ({checkpoint: {marker: 'preserved'}})});
    await first.run(work.id, 'owner');
    const second = new ConversationWorkSupervisor({store, verify, runSegment: async ({checkpoint}) => {
      expect(checkpoint.marker).toBe('preserved'); return {checkpoint: {finished: true}};
    }});
    expect((await second.run(work.id, 'owner')).status).toBe('succeeded');
  });
  it('runs 100 segments with 2000 scripted operations and bounded checkpoints', async () => {
    let operations = 0;
    for (let segment = 1; segment <= 100; segment++) {
      const supervisor = new ConversationWorkSupervisor({store, verify, clock: () => segment * 1000000, runSegment: async ({checkpoint, assertOwnership}) => {
        await assertOwnership();
        operations += 20;
        return {checkpoint: {segment: (checkpoint.segment ?? 0) + 1, finished: segment === 100}};
      }});
      expect((await supervisor.run(work.id, 'owner')).status).toBe(segment === 100 ? 'succeeded' : 'queued');
    }
    expect(operations).toBe(2000);
    expect((await store.find(work.id, 'owner')).checkpoint_json.length).toBeLessThan(256);
  });
});
