/**
 * forkConversation against the real (per-run) database: a fork must carry the
 * server state that makes "keep all the context above" true — the cut provider
 * transcript, the prompt state that gates rehydration, the conversation's
 * settings and its offloaded data — and must never carry another user's.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import db, { dbReady } from '../../models/database/index.js';
import ConversationLogModel from '../../models/ConversationLogModel.js';
import ConversationSettingsModel from '../../models/ConversationSettingsModel.js';
import { saveConversationState, loadConversationState, __resetConversationStateCache } from './conversationStateStore.js';
import { persistDataRef, loadDataRef } from './dataRefStore.js';
import { forkConversation } from './conversationFork.js';

const USER = `fork-owner-${randomUUID()}`;
const OTHER = `fork-other-${randomUUID()}`;
const cut = [
  { role: 'user', content: 'find the bug' },
  { role: 'assistant', content: [{ type: 'thinking', thinking: 'grep first', signature: 'SIG' }, { type: 'text', text: 'It is in a.js.' }] },
];

async function seedSource(owner = USER) {
  const sourceId = randomUUID();
  await ConversationLogModel.create({ conversationId: sourceId, userId: owner, initial_prompt: 'find the bug', full_history: JSON.stringify([...cut, { role: 'user', content: 'later' }]), final_response: 'x', tool_calls: '[]', errors: null });
  await saveConversationState(sourceId, owner, { _frozenCustomInstructions: 'be brief', _cacheRoundState: { provider: 'anthropic', model: 'claude' }, _evictedUnits: 3 });
  await ConversationSettingsModel.upsert({ conversationId: sourceId, userId: owner, activeSkillId: 'skill-1', provider: 'anthropic', model: 'claude', routingMode: 'pinned' });
  await persistDataRef(sourceId, owner, 'data-call_a-1-0', '{"rows":[1,2,3]}', { type: 'json' });
  return sourceId;
}

const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())));

beforeAll(async () => {
  await dbReady;
  __resetConversationStateCache();
  // conversation_settings.user_id references users(id).
  for (const id of [USER, OTHER]) await dbRun('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)', [id, `${id}@test.local`, id]);
});

describe('forkConversation', { timeout: 30000 }, () => {
  it('copies the cut log, prompt state, settings and data refs under a new id', async () => {
    const sourceId = await seedSource();
    const log = await ConversationLogModel.getByConversationId(sourceId, USER);
    const fork = await forkConversation({ sourceId, userId: USER, log, messages: cut });

    expect(fork.conversationId).not.toBe(sourceId);
    expect(fork.copied).toEqual({ promptState: true, settings: true, dataRefs: 1 });

    const forkedLog = await ConversationLogModel.getByConversationId(fork.conversationId, USER);
    expect(forkedLog.messages).toEqual(cut); // thinking block and signature intact
    expect(forkedLog.finalResponse).toBe('It is in a.js.');
    expect(forkedLog.initialPrompt).toBe('find the bug');

    const state = await loadConversationState(fork.conversationId);
    expect(state._cacheRoundState).toEqual({ provider: 'anthropic', model: 'claude' });
    expect(state._frozenCustomInstructions).toBe('be brief');

    const settings = await ConversationSettingsModel.get(fork.conversationId);
    expect(settings).toMatchObject({ user_id: USER, active_skill_id: 'skill-1', provider: 'anthropic', model: 'claude', routing_mode: 'pinned' });

    expect((await loadDataRef(fork.conversationId, USER, 'data-call_a-1-0')).content).toBe('{"rows":[1,2,3]}');
  });

  it('leaves the source untouched', async () => {
    const sourceId = await seedSource();
    const log = await ConversationLogModel.getByConversationId(sourceId, USER);
    await forkConversation({ sourceId, userId: USER, log, messages: cut });
    expect((await ConversationLogModel.getByConversationId(sourceId, USER)).messages).toHaveLength(3);
    expect(await loadDataRef(sourceId, USER, 'data-call_a-1-0')).not.toBeNull();
  });

  it('never copies another user\'s settings or data into the fork', async () => {
    const sourceId = await seedSource(OTHER);
    const fork = await forkConversation({ sourceId, userId: USER, log: null, messages: cut });
    expect(fork.copied).toEqual({ promptState: false, settings: false, dataRefs: 0 });
    expect(await ConversationSettingsModel.get(fork.conversationId)).toBeNull();
    expect(await loadConversationState(fork.conversationId)).toBeNull();
  });

  it('still forks when the source has no side state', async () => {
    const sourceId = randomUUID();
    const fork = await forkConversation({ sourceId, userId: USER, log: null, messages: cut });
    expect(fork.copied).toEqual({ promptState: false, settings: false, dataRefs: 0 });
    expect((await ConversationLogModel.getByConversationId(fork.conversationId, USER)).messages).toEqual(cut);
  });
});
