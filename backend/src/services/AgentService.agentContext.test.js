/**
 * _getAgentContext resolves the agent's ASSIGNED tools — including custom ones.
 *
 * This is the literal test that would have caught issue #64. The function had
 * `userId` in scope (it uses it for the 403 check) but called
 * getAvailableToolSchemas() without it, and getAvailableToolSchemas only loads
 * Tool Forge tools when a userId is supplied. So every assigned custom tool
 * missed the name lookup, emitted a console.warn nobody reads, and
 * availableTools came back [].
 *
 * Nothing threw. The agent chat handed the model an empty tool list, the model
 * could not emit a tool_use block, and it narrated a plausible result instead.
 * A silent wrong answer is the only failure mode a test is strictly required
 * for — an exception would have found itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./OrchestratorService.js', () => ({ default: vi.fn() }));
vi.mock('../models/database/index.js', () => ({ default: {} }));
vi.mock('../models/UserModel.js', () => ({ default: { getUserSettings: vi.fn(async () => ({})) } }));
vi.mock('../utils/realtimeSync.js', () => ({
  broadcast: vi.fn(),
  broadcastToUser: vi.fn(),
  RealtimeEvents: {},
}));
vi.mock('../models/AgentModel.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('./orchestrator/tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));

import AgentService from './AgentService.js';
import AgentModel from '../models/AgentModel.js';
import { getAvailableToolSchemas } from './orchestrator/tools.js';

const USER_ID = 'user-1';
const AGENT_ID = 'agent-prometheus';
const CUSTOM_TOOL = 'tool-prom-query';
const BUILTIN_TOOL = 'web_search';

const schema = (name) => ({
  type: 'function',
  function: { name, description: `${name} does a thing.`, parameters: { type: 'object', properties: {} } },
});

beforeEach(() => {
  // The registry ASYMMETRY is the bug. Custom tools exist only when the
  // caller identifies the user; built-ins are always there. Reproducing that
  // here is what stops these assertions from being vacuous.
  getAvailableToolSchemas.mockReset();
  getAvailableToolSchemas.mockImplementation(async ({ userId } = {}) =>
    userId ? [schema(BUILTIN_TOOL), schema(CUSTOM_TOOL)] : [schema(BUILTIN_TOOL)]
  );

  AgentModel.findOne.mockReset();
  AgentModel.findOne.mockResolvedValue({
    id: AGENT_ID,
    name: 'Prometheus Scanner',
    description: 'Queries a client Prometheus instance.',
    systemPrompt: 'You audit legacy infrastructure.',
    assignedTools: [BUILTIN_TOOL, CUSTOM_TOOL],
    created_by: USER_ID,
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
  });
});

const toolNames = (ctx) => ctx.agentContext.availableTools.map((t) => t.function.name);

describe('_getAgentContext', () => {
  it('the fixture really does hide custom tools from an anonymous caller', async () => {
    const anon = await getAvailableToolSchemas();
    expect(anon.map((t) => t.function.name)).not.toContain(CUSTOM_TOOL);
  });

  it('THE #64 REGRESSION: an agent assigned a Tool Forge tool gets a NON-EMPTY tool list', async () => {
    const ctx = await AgentService._getAgentContext(AGENT_ID, USER_ID);
    expect(ctx.error).toBeUndefined();
    expect(ctx.agentContext.availableTools.length).toBeGreaterThan(0);
    expect(toolNames(ctx)).toContain(CUSTOM_TOOL);
  });

  it('identifies the user to the tool registry on every call', async () => {
    await AgentService._getAgentContext(AGENT_ID, USER_ID);
    expect(getAvailableToolSchemas).toHaveBeenCalled();
    for (const call of getAvailableToolSchemas.mock.calls) {
      expect(call[0]?.userId).toBe(USER_ID);
    }
  });

  it('still resolves built-in tools, and still resolves ONLY what was assigned', async () => {
    AgentModel.findOne.mockResolvedValue({
      id: AGENT_ID, name: 'A', systemPrompt: '', assignedTools: [BUILTIN_TOOL], created_by: USER_ID,
    });
    const names = toolNames(await AgentService._getAgentContext(AGENT_ID, USER_ID));
    expect(names).toEqual([BUILTIN_TOOL]);
  });

  it('keeps the ownership gate — a stranger gets 403, not another user\u2019s tools', async () => {
    const ctx = await AgentService._getAgentContext(AGENT_ID, 'someone-else');
    expect(ctx.status).toBe(403);
    expect(ctx.agentContext).toBeUndefined();
  });

  it('returns 404 for a missing agent', async () => {
    AgentModel.findOne.mockResolvedValue(null);
    expect((await AgentService._getAgentContext('nope', USER_ID)).status).toBe(404);
  });
});
