/**
 * Per-conversation AI override columns on conversation_settings.
 *
 * A conversation can pin its own { provider, model } separately from the
 * account-wide default. The row is shared with the skill/goal bindings, so
 * the merge semantics are load-bearing: a PATCH that only touches the AI
 * override must not wipe an attached skill, and vice versa. `undefined`
 * means "leave unchanged", `null` means "clear".
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let ConversationSettingsModel;
let TMP;
const savedEnv = {};

const CONV = 'conv-ai-override-1';

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-convai-'));
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

  ConversationSettingsModel = (await import('./ConversationSettingsModel.js')).default;
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('conversation_settings AI override', () => {
  it('migration added provider/model columns (fresh DB round-trip)', async () => {
    const row = await ConversationSettingsModel.upsert({
      conversationId: CONV,
      provider: 'anthropic',
      model: 'claude-x',
    });
    expect(row.provider).toBe('anthropic');
    expect(row.model).toBe('claude-x');

    const read = await ConversationSettingsModel.get(CONV);
    expect(read.provider).toBe('anthropic');
    expect(read.model).toBe('claude-x');
  });

  it('undefined leaves the AI override unchanged when PATCHing a skill', async () => {
    await ConversationSettingsModel.upsert({ conversationId: CONV, activeSkillId: 'skill-1' });

    const read = await ConversationSettingsModel.get(CONV);
    expect(read.active_skill_id).toBe('skill-1');
    // The AI override from the previous test must have survived untouched.
    expect(read.provider).toBe('anthropic');
    expect(read.model).toBe('claude-x');
  });

  it('an AI-only PATCH does not wipe the skill binding', async () => {
    await ConversationSettingsModel.upsert({ conversationId: CONV, provider: 'openai', model: 'gpt-x' });

    const read = await ConversationSettingsModel.get(CONV);
    expect(read.provider).toBe('openai');
    expect(read.model).toBe('gpt-x');
    expect(read.active_skill_id).toBe('skill-1');
  });

  it('null clears the override without touching other fields', async () => {
    await ConversationSettingsModel.upsert({ conversationId: CONV, provider: null, model: null });

    const read = await ConversationSettingsModel.get(CONV);
    expect(read.provider).toBeNull();
    expect(read.model).toBeNull();
    expect(read.active_skill_id).toBe('skill-1');
  });

  it('get returns null for a conversation with no settings row', async () => {
    expect(await ConversationSettingsModel.get('conv-never-seen')).toBeNull();
  });
});
