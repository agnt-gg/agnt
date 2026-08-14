/**
 * Dynamic routing persistence — users, conversations, agents, decisions.
 *
 * The property this file exists to prove is that THE FEATURE IS OFF BY
 * DEFAULT AND CANNOT BE TURNED ON BY ACCIDENT. Every column is additive and
 * every legacy row (NULL) must resolve to today's behaviour, because the
 * migration deliberately performs no backfill.
 *
 * Runs against a throwaway AGNT_HOME — never touches the user's database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';

let db;
let UserModel;
let ConversationSettingsModel;
let RoutingDecisionModel;
let TMP;
const savedEnv = {};

const USER = 'user-routing-1';
const CONV = 'conv-routing-1';

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (e) { e ? reject(e) : resolve(this); }));
const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (e, r) => (e ? reject(e) : resolve(r))));

beforeAll(async () => {
  TMP = await fsp.mkdtemp(path.join(os.tmpdir(), 'agnt-routing-'));
  for (const k of ['AGNT_HOME', 'USER_DATA_PATH', 'DOCKER_CONTAINER']) savedEnv[k] = process.env[k];
  delete process.env.USER_DATA_PATH;
  delete process.env.DOCKER_CONTAINER;
  process.env.AGNT_HOME = TMP;

  const dataDir = path.join(TMP, '.agnt', 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  await fsp.writeFile(path.join(dataDir, 'agnt.db'), '');

  const dbMod = await import('./database/index.js');
  db = dbMod.default;
  await dbMod.dbReady;

  UserModel = (await import('./UserModel.js')).default;
  ConversationSettingsModel = (await import('./ConversationSettingsModel.js')).default;
  RoutingDecisionModel = (await import('./RoutingDecisionModel.js')).default;

  await dbRun(`INSERT INTO users (id, email, name) VALUES (?,?,?)`,
    [USER, 'r@example.com', 'routing-tester']);
}, 120000);

afterAll(async () => {
  await new Promise((r) => db.close(r));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await fsp.rm(TMP, { recursive: true, force: true }).catch(() => {});
});

describe('users.routing_mode — off by default, opt-in only', () => {
  it('a brand-new row reports static/balanced without any backfill', () => {
    return UserModel.getUserSettings(USER).then((s) => {
      expect(s.routingMode).toBe('static');
      expect(s.routingPolicy).toBe('balanced');
    });
  });

  it('a legacy row with an explicit NULL still reads static', async () => {
    // The column default only applies to rows inserted after the migration.
    // Rows that predate it hold NULL, which is the case that actually ships.
    await dbRun(`UPDATE users SET routing_mode = NULL, routing_policy = NULL WHERE id = ?`, [USER]);
    const s = await UserModel.getUserSettings(USER);
    expect(s.routingMode).toBe('static');
    expect(s.routingPolicy).toBe('balanced');
  });

  it('round-trips an enabled router', async () => {
    await UserModel.updateUserSettings(USER, { routingMode: 'dynamic', routingPolicy: 'save' });
    const s = await UserModel.getUserSettings(USER);
    expect(s.routingMode).toBe('dynamic');
    expect(s.routingPolicy).toBe('save');
  });

  it('a junk mode is normalised to OFF on the way into the column', async () => {
    // Defence in depth: the route rejects this loudly, but a second caller
    // that skips validation must still not be able to enable routing.
    await UserModel.updateUserSettings(USER, { routingMode: 'DYNAMIC!!' });
    expect((await UserModel.getUserSettings(USER)).routingMode).toBe('static');

    const raw = await dbGet(`SELECT routing_mode FROM users WHERE id = ?`, [USER]);
    expect(raw.routing_mode).toBe('static');
  });

  it('a junk policy collapses to balanced', async () => {
    await UserModel.updateUserSettings(USER, { routingPolicy: 'cheapest-possible' });
    expect((await UserModel.getUserSettings(USER)).routingPolicy).toBe('balanced');
  });

  it('updating routing does not disturb the provider/model defaults', async () => {
    await UserModel.updateUserSettings(USER, { selectedProvider: 'anthropic', selectedModel: 'claude-x' });
    await UserModel.updateUserSettings(USER, { routingMode: 'dynamic' });
    const s = await UserModel.getUserSettings(USER);
    expect(s.selectedProvider).toBe('anthropic');
    expect(s.selectedModel).toBe('claude-x');
    expect(s.routingMode).toBe('dynamic');
  });

  it('the fallback chain is untouched by routing — it is the rollback', async () => {
    await UserModel.updateUserSettings(USER, {
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'openai', model: 'gpt-x' }],
    });
    await UserModel.updateUserSettings(USER, { routingMode: 'dynamic' });
    const s = await UserModel.getUserSettings(USER);
    expect(s.fallbackEnabled).toBe(true);
    expect(s.fallbackProviders).toEqual([{ provider: 'openai', model: 'gpt-x' }]);
  });
});

describe('conversation_settings.routing_mode', () => {
  it('defaults to NULL — "this chat has no opinion"', async () => {
    await ConversationSettingsModel.upsert({ conversationId: CONV, userId: USER, provider: 'a', model: 'm' });
    const row = await ConversationSettingsModel.get(CONV);
    expect(row.routing_mode).toBeNull();
  });

  it('round-trips a mode without disturbing the pair', async () => {
    await ConversationSettingsModel.upsert({ conversationId: CONV, routingMode: 'dynamic' });
    const row = await ConversationSettingsModel.get(CONV);
    expect(row.routing_mode).toBe('dynamic');
    expect(row.provider).toBe('a');
    expect(row.model).toBe('m');
  });

  it('a partial PATCH of the pair leaves the mode alone', async () => {
    await ConversationSettingsModel.upsert({ conversationId: CONV, provider: null, model: null });
    const row = await ConversationSettingsModel.get(CONV);
    expect(row.routing_mode).toBe('dynamic');
    expect(row.provider).toBeNull();
  });

  it('a skill binding survives a routing change (shared row, merge semantics)', async () => {
    await ConversationSettingsModel.upsert({ conversationId: CONV, activeSkillId: 'skill-9' });
    await ConversationSettingsModel.upsert({ conversationId: CONV, routingMode: 'default' });
    const row = await ConversationSettingsModel.get(CONV);
    expect(row.active_skill_id).toBe('skill-9');
    expect(row.routing_mode).toBe('default');
  });

  it('clearing the mode restores "no opinion"', async () => {
    await ConversationSettingsModel.upsert({ conversationId: CONV, routingMode: null });
    expect((await ConversationSettingsModel.get(CONV)).routing_mode).toBeNull();
  });
});

describe('routing_decisions — the audit trail', () => {
  it('records a decision with its counterfactual', async () => {
    const id = await RoutingDecisionModel.record({
      userId: USER,
      conversationId: CONV,
      origin: 'orchestrator',
      mode: 'dynamic',
      policy: 'balanced',
      stake: 'normal',
      verifiability: 'subjective',
      chosenProvider: 'anthropic',
      chosenModel: 'haiku',
      chosenReason: 'cheapest capable',
      baselineProvider: 'openai',
      baselineModel: 'gpt-5.2',
      predictedCostUsd: 0.004,
      baselineCostUsd: 0.019,
      candidatesConsidered: 12,
      chain: [{ provider: 'anthropic', model: 'haiku' }],
    });
    expect(id).toBeTruthy();

    const s = await RoutingDecisionModel.summary(USER, { sinceHours: 24 });
    expect(s.decisions).toBe(1);
    expect(s.savedUsd).toBeCloseTo(0.015, 6);
    expect(s.distribution[0]).toMatchObject({ provider: 'anthropic', model: 'haiku', calls: 1 });
  });

  it('an UNPRICED decision is excluded from savings and counted separately', async () => {
    // The rule that keeps the headline number reproducible: unknown is never
    // folded in as zero.
    await RoutingDecisionModel.record({
      userId: USER,
      chosenProvider: 'mystery',
      chosenModel: 'unpriced',
      baselineProvider: 'openai',
      baselineModel: 'gpt-5.2',
      predictedCostUsd: null,
      baselineCostUsd: 0.019,
    });

    const s = await RoutingDecisionModel.summary(USER, { sinceHours: 24 });
    expect(s.decisions).toBe(2);
    expect(s.savedUsd).toBeCloseTo(0.015, 6); // unchanged by the unpriced row
    expect(s.unpricedDecisions).toBe(1);
  });

  it('shadow decisions are separable from executed ones', async () => {
    await RoutingDecisionModel.record({
      userId: USER, chosenProvider: 'groq', chosenModel: 'shadowed',
      predictedCostUsd: 0.001, baselineCostUsd: 0.01, shadow: true,
    });
    const executed = await RoutingDecisionModel.summary(USER, { sinceHours: 24, shadow: false });
    const shadowed = await RoutingDecisionModel.summary(USER, { sinceHours: 24, shadow: true });
    expect(executed.decisions).toBe(2);
    expect(shadowed.decisions).toBe(1);
  });

  it('a write without a user is dropped rather than throwing', async () => {
    // Observability must never be able to break a turn.
    expect(await RoutingDecisionModel.record({ chosenProvider: 'x' })).toBeNull();
  });

  it('recent() returns newest first and is bounded', async () => {
    const rows = await RoutingDecisionModel.recent(USER, 2);
    expect(rows.length).toBe(2);
    expect(rows[0].chosen_provider).toBe('groq');
  });
});
