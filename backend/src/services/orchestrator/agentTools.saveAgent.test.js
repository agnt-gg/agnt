/**
 * save_agent, as Annie's agent chats call it (2026-10-23). It used to INSERT
 * into columns `agents` no longer has ("no column named instructions"), so
 * every save failed; and it took its id from context.agentId first, which on
 * the builder chat is the 'agent-chat' sentinel. Real (per-run) database.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import db, { dbReady } from '../../models/database/index.js';
import AgentModel from '../../models/AgentModel.js';
import { AGENT_TOOLS } from './agentTools.js';

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, (err) => (err ? reject(err) : resolve())));
const newUser = async () => {
  const id = randomUUID();
  await run('INSERT INTO users (id, email) VALUES (?, ?)', [id, `${id}@test.local`]);
  return id;
};
const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (err, row) => (err ? reject(err) : resolve(row))));
const save = async (agentState, extra = {}) => JSON.parse(await AGENT_TOOLS.save_agent.execute({}, 'token', { agentId: 'agent-chat', agentState, ...extra }));
let user;
beforeAll(async () => {
  await dbReady;
  user = await newUser();
});

describe('save_agent', { timeout: 30000 }, () => {
  it('a new agent from the builder chat is created under a real id, with her instructions as its prompt', async () => {
    const result = await save({ id: `agent_${Date.now()}`, name: 'Inbox Helper', description: 'Triage', instructions: 'You triage email.', tools: ['web_search'], provider: 'openai-codex', model: 'm' }, { userId: user });
    expect(result.error ?? null).toBeNull();
    expect(result.success).toBe(true);
    expect(result.agentId).toMatch(/^[0-9a-f-]{36}$/);
    const stored = await AgentModel.findOne(result.agentId);
    expect([stored.name, stored.systemPrompt, stored.assignedTools, stored.created_by]).toEqual(['Inbox Helper', 'You triage email.', ['web_search'], user]);
    expect(await get(`SELECT id FROM agents WHERE id IN ('agent-chat', 'orchestrator')`)).toBeUndefined();
  });

  it('your own agent is updated in place, keeping what the draft does not mention', async () => {
    const first = await save({ name: 'Writer', instructions: 'v1', tools: ['a'], provider: 'p', model: 'm' }, { userId: user });
    const again = await save({ id: first.agentId, name: 'Writer 2', instructions: 'v2' }, { userId: user });
    expect(again.agentId).toBe(first.agentId);
    const stored = await AgentModel.findOne(first.agentId);
    expect([stored.name, stored.systemPrompt, stored.assignedTools]).toEqual(['Writer 2', 'v2', ['a']]);
  });

  it('someone else\u2019s agent is never overwritten: a copy is saved for you', async () => {
    const theirs = await save({ name: 'Theirs', instructions: 'keep', provider: 'p', model: 'm' }, { userId: await newUser() });
    const mine = await save({ id: theirs.agentId, name: 'Mine', instructions: 'changed', provider: 'p', model: 'm' }, { userId: user });
    expect(mine.agentId).not.toBe(theirs.agentId);
    expect((await AgentModel.findOne(theirs.agentId)).systemPrompt).toBe('keep');
  });

  it('without a signed-in user nothing is saved', async () => {
    expect(await save({ name: 'x' })).toMatchObject({ success: false });
  });
});
