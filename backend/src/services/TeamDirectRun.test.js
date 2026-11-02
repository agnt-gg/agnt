import { it, expect, vi, beforeEach, afterEach } from 'vitest';

// An agent on a board card with no published version used to answer "I am not published for this
// teamspace yet". It now runs its current definition as the teammate who assigned it, in their sandbox.
const state = vi.hoisted(() => ({ calls: [], agent: null, denied: new Set() }));
vi.mock('../models/AgentModel.js', () => ({ default: { findOne: async () => state.agent } }));
vi.mock('./orchestrator/tools.js', () => ({ getAvailableToolSchemas: async () => [{ function: { name: 'web_search' } }, { function: { name: 'execute_shell_command' } }] }));
vi.mock('./ai/LlmExecutionService.js', async () => {
  const { currentToolActor, currentToolAuthorization } = await import('./security/toolRunAuthority.js');
  return { default: { executeWithTools: async (config) => { state.calls.push({ config, actor: currentToolActor(), authorization: currentToolAuthorization() }); return { success: true, content: 'done' }; } } };
});
const { runAgentAsTeammate } = await import('./TeamDirectRun.js');
const cloud = { request: async (_auth, route) => { const capability = route.split('/').pop(); if (state.denied.has(capability)) throw Object.assign(new Error('Not allowed'), { status: 403 }); return {}; } };
const scope = { id: 'workspace:w', resourceOwnerId: 'scope:w' };
const run = (actorId, team = { id: 't', tenantSlug: 'bravo' }) => runAgentAsTeammate({ team, actorId, authorization: 'Bearer member', scope, workspaceId: 'w', agentId: 'a1', input: 'Draft it', cloud });

beforeEach(() => {
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1'); vi.stubEnv('AGNT_TENANT_MEMBERS', 'owner-1,member-2'); vi.stubEnv('JWT_SECRET', 'x'.repeat(64));
  state.calls.length = 0; state.denied.clear();
  state.agent = { id: 'a1', created_by: 'scope:w', provider: 'openai', model: 'gpt', systemPrompt: 'Be useful', assignedTools: ['web_search'] };
});
afterEach(() => vi.unstubAllEnvs());

it("runs the agent as the teammate, on the workspace's data, with only its assigned tools", async () => {
  expect(await run('member-2')).toEqual({ status: 'completed', result: { success: true, content: 'done' } });
  const [{ config, actor, authorization }] = state.calls;
  expect(actor).toBe('member-2');
  expect(authorization).toMatch(/^Bearer agnt-tool\./);
  expect(config).toMatchObject({ userId: 'scope:w', systemPrompt: 'Be useful', context: { agentId: 'a1', actorId: 'member-2' } });
  expect(config.toolSchemas.map((schema) => schema.function.name)).toEqual(['web_search']);
});

it("follows the owner's settings: run policy off, or no connections.use here, refuses", async () => {
  await expect(run('member-2', { id: 't', tenantSlug: 'bravo', policy: { permissions: { 'workflows.run': false } } })).rejects.toMatchObject({ status: 403, code: 'team_policy_denied' });
  state.denied.add('connections.use');
  await expect(run('member-2')).rejects.toMatchObject({ status: 403 });
  expect(state.calls).toEqual([]);
});

it("refuses an agent from another workspace", async () => {
  state.agent.created_by = 'scope:other';
  await expect(run('member-2')).rejects.toMatchObject({ status: 404 });
});
