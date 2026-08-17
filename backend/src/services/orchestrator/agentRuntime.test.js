/**
 * AGENT RUNTIME PARITY — the tests that would have caught issue #64.
 *
 * A saved agent is run from three places: the agent chat, the `agnt-agent`
 * workflow node, and the goal system (which the `run_agent` orchestrator tool
 * also routes through). For months only the chat surface assembled the whole
 * agent; the other two hand-rolled a subset and drifted from it. Nobody
 * noticed, because the failure mode is not an exception — an empty tool list
 * cannot produce a tool_use block, so the model narrates a plausible result
 * and reports success.
 *
 * There are two halves here and both are necessary:
 *
 *   BEHAVIOUR  — a workflow/goal agent really does receive its custom tools,
 *                its skills and its memory.
 *   STRUCTURE  — no consumer may reassemble an agent runtime by hand again.
 *                The behaviour tests below pass for the fixed code AND for a
 *                future copy-paste that reintroduces a second assembly path;
 *                only the structural guard fails that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./workspaceContext.js', () => ({
  loadWorkspaceContextSection: vi.fn(async () => ''),
}));
vi.mock('../../models/AgentModel.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../models/UserModel.js', () => ({
  default: { getUserSettings: vi.fn(async () => ({})) },
}));
vi.mock('../../models/AgentMemoryModel.js', () => ({
  default: {
    findRelevant: vi.fn(async () => []),
    findByAgentId: vi.fn(async () => []),
    findByUserId: vi.fn(async () => []),
  },
}));
vi.mock('../../models/SkillModel.js', () => ({
  default: { findAll: vi.fn(async () => []), findByIds: vi.fn(async () => []) },
}));

import { buildAgentRuntime } from './agentRuntime.js';
import { getAvailableToolSchemas } from './tools.js';
import { AGENT_DEFAULT_TOOLS } from './chatConfigs.js';
import AgentModel from '../../models/AgentModel.js';
import AgentMemoryModel from '../../models/AgentMemoryModel.js';
import SkillModel from '../../models/SkillModel.js';
import { DEFAULT_TOOLS, TOOL_GROUPS } from './toolSelector.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../..'); // backend/src

const USER_ID = 'user-1';
const AGENT_ID = 'agent-prometheus';

// The reporter's actual shape: a Tool Forge tool, kebab-cased by toToolSchema,
// assigned to an agent that queries a client's Prometheus instance.
const CUSTOM_TOOL = 'tool-prom-query';

const schema = (name) => ({
  type: 'function',
  function: { name, description: `${name} does a thing.`, parameters: { type: 'object', properties: {} } },
});

/**
 * Registry WITHOUT custom tools — what getAvailableToolSchemas returns when
 * called with no userId. This asymmetry is the whole bug, so the fixture
 * reproduces it rather than assuming it away.
 */
function builtinRegistry() {
  const names = new Set();
  for (const n of DEFAULT_TOOLS) names.add(n);
  for (const n of AGENT_DEFAULT_TOOLS) names.add(n);
  for (const group of Object.values(TOOL_GROUPS)) for (const n of group) names.add(n);
  return [...names].map(schema);
}

const namesOf = (schemas) => new Set(schemas.map((s) => s.function.name));

beforeEach(() => {
  getAvailableToolSchemas.mockReset();
  getAvailableToolSchemas.mockImplementation(async ({ userId } = {}) =>
    userId ? [...builtinRegistry(), schema(CUSTOM_TOOL)] : builtinRegistry()
  );

  AgentModel.findOne.mockReset();
  AgentModel.findOne.mockResolvedValue({
    id: AGENT_ID,
    name: 'Prometheus Scanner',
    description: 'Queries a client Prometheus instance.',
    systemPrompt: 'You audit legacy infrastructure and report findings plainly.',
    assignedTools: [CUSTOM_TOOL],
    assignedSkills: ['infra-audit'],
    toolAccessMode: 'restricted',
    created_by: USER_ID,
  });

  AgentMemoryModel.findRelevant.mockReset();
  AgentMemoryModel.findRelevant.mockResolvedValue([
    { id: 'm1', memory_type: 'fact', content: 'The client runs Prometheus on port 9090.', agent_id: AGENT_ID },
  ]);

  const INFRA_AUDIT = { slug: 'infra-audit', name: 'infra-audit', description: 'Audit legacy infrastructure safely.' };
  SkillModel.findAll.mockReset();
  SkillModel.findAll.mockResolvedValue([INFRA_AUDIT]);
  // buildSpecialtySkillsSection resolves assignedSkills through findByIds — a
  // DIFFERENT method from the one that builds the general catalog. Mocking
  // only findAll left the specialty block silently empty (it swallows the
  // error), which is how the catalog and the specialty highlight can drift
  // apart without anyone noticing.
  SkillModel.findByIds.mockReset();
  SkillModel.findByIds.mockResolvedValue([INFRA_AUDIT]);
});

const runtimeForWorkflow = () =>
  buildAgentRuntime({
    agentId: AGENT_ID,
    userId: USER_ID,
    latestUserMessage: 'scan the public facing IPs',
    provider: 'anthropic',
  });

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOUR
// ─────────────────────────────────────────────────────────────────────────────

describe('the fixture reproduces the original defect (anti-vacuity)', () => {
  it('a userId-less registry genuinely omits custom tools', async () => {
    // If this ever passes trivially, every assertion below is meaningless:
    // they would hold whether or not userId is threaded through.
    const without = namesOf(await getAvailableToolSchemas());
    const with_ = namesOf(await getAvailableToolSchemas({ userId: USER_ID }));
    expect(without.has(CUSTOM_TOOL)).toBe(false);
    expect(with_.has(CUSTOM_TOOL)).toBe(true);
  });
});

describe('a workflow/goal agent receives its assigned custom tools', () => {
  it('THE #64 REGRESSION: availableTools is not empty and contains the Tool Forge tool', async () => {
    const { toolSchemas } = await runtimeForWorkflow();
    expect(toolSchemas.length).toBeGreaterThan(0);
    expect(namesOf(toolSchemas).has(CUSTOM_TOOL)).toBe(true);
  });

  it('asks the registry for the USER\u2019s tools, never the anonymous set', async () => {
    await runtimeForWorkflow();
    expect(getAvailableToolSchemas).toHaveBeenCalled();
    for (const call of getAvailableToolSchemas.mock.calls) {
      expect(call[0]?.userId).toBe(USER_ID);
    }
  });

  it('still honours the restricted ceiling \u2014 the fix widens nothing it should not', async () => {
    const names = namesOf((await runtimeForWorkflow()).toolSchemas);
    // execute_shell_command is a real registered tool this agent never asked
    // for. A fix that simply handed over the whole registry would pass every
    // other assertion in this file.
    expect(names.has('execute_shell_command')).toBe(false);
  });

  it('ships the skills and memory tools the prompt tells the agent to call', async () => {
    const names = namesOf((await runtimeForWorkflow()).toolSchemas);
    for (const n of ['activate_skill', 'save_agent_memory', 'get_agent_memories']) {
      expect(names.has(n)).toBe(true);
    }
  });
});

describe('a workflow/goal agent gets the whole prompt, not just its persona', () => {
  it('keeps the persona first', async () => {
    const { systemPrompt } = await runtimeForWorkflow();
    expect(systemPrompt).toContain('Prometheus Scanner');
    expect(systemPrompt).toContain('You audit legacy infrastructure');
  });

  it('carries the skills catalog and the agent\u2019s specialty skills', async () => {
    const { systemPrompt } = await runtimeForWorkflow();
    expect(systemPrompt).toContain('infra-audit');
    expect(systemPrompt).toContain('Your Specialty Skills');
  });

  it('carries agent memory', async () => {
    const { systemPrompt } = await runtimeForWorkflow();
    expect(systemPrompt).toContain('Prometheus on port 9090');
  });

  it('carries the assigned-tool manifest', async () => {
    const { systemPrompt } = await runtimeForWorkflow();
    expect(systemPrompt).toContain(CUSTOM_TOOL);
  });

  it('resolves the tool surface BEFORE the prompt, so block gates see it', async () => {
    // buildUnifiedSystemPrompt gates optional blocks on context.toolSchemas.
    // Build the prompt first and every gate reads undefined.
    const { context, toolSchemas } = await runtimeForWorkflow();
    expect(context.toolSchemas).toBe(toolSchemas);
  });
});

describe('the guard rails on buildAgentRuntime itself', () => {
  it('refuses a missing userId instead of quietly returning an amnesiac agent', async () => {
    await expect(buildAgentRuntime({ agentId: AGENT_ID, userId: null })).rejects.toThrow(/userId/);
  });

  it('refuses the agent-builder sentinel id', async () => {
    await expect(buildAgentRuntime({ agentId: 'agent-chat', userId: USER_ID })).rejects.toThrow(/saved agent id/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURE — one assembly path, enforced against the real source tree.
// ─────────────────────────────────────────────────────────────────────────────

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

/** Strip comments so the scanner reads CODE, never prose describing code. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*')) return '';
      const idx = line.indexOf('//');
      if (idx === -1) return line;
      const before = line.slice(0, idx);
      if (before.endsWith(':')) return line; // http://
      const quotes = (before.match(/['"`]/g) || []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join('\n');
}

const CONSUMERS = {
  'workflow agent node': 'tools/library/actions/agnt-agent.js',
  'goal task orchestrator': 'services/goal/TaskOrchestrator.js',
};

describe('every saved-agent consumer uses the shared runtime', () => {
  for (const [label, rel] of Object.entries(CONSUMERS)) {
    it(`${label} builds its runtime through buildAgentRuntime`, () => {
      const code = stripComments(read(rel));
      expect(code).toMatch(/buildAgentRuntime\s*\(/);
    });

    it(`${label} does not reach for the tool registry directly`, () => {
      // Calling getAvailableToolSchemas here is how both of these drifted:
      // it is the one function whose userId argument is easy to forget and
      // impossible to notice missing.
      const code = stripComments(read(rel));
      expect(code).not.toMatch(/getAvailableToolSchemas\s*\(/);
    });
  }

  it('the workflow node no longer hand-builds a system prompt from agentContext', () => {
    const code = stripComments(read(CONSUMERS['workflow agent node']));
    expect(code).not.toMatch(/agentContext\.systemPrompt/);
    expect(code).not.toMatch(/agentContext\.availableTools/);
  });

  it('the goal system has no private agent prompt builder', () => {
    // buildAgentSystemPrompt was a second, smaller prompt assembler living in
    // LlmExecutionService. Deleted \u2014 a working-looking duplicate is an
    // invitation to use it.
    const code = stripComments(read('services/ai/LlmExecutionService.js'));
    expect(code).not.toMatch(/buildAgentSystemPrompt/);
  });

  it('agentRuntime delegates to the chat config rather than reimplementing it', () => {
    // The anti-drift property is DELEGATION. If this module ever grows its
    // own tool filtering or prompt assembly, #64 is one refactor away from
    // coming back.
    const code = stripComments(read('services/orchestrator/agentRuntime.js'));
    expect(code).toMatch(/getChatConfig\(\s*['"]agent['"]\s*\)/);
    expect(code).not.toMatch(/getAvailableToolSchemas/);
    expect(code).not.toMatch(/buildUnifiedSystemPrompt/);
  });
});
