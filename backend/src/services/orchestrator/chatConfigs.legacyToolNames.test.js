/**
 * Agents installed from agnt.gg before runtime tool names were enforced hold
 * website slugs ("gmail") instead of registered names ("gmail_api"). In
 * restricted mode they were granted none of their integrations and said
 * nothing. These tests drive the REAL saved-agent surface and prompt builder
 * with the same turn context, in the order every runtime uses them
 * (OrchestratorService: getToolSchemas -> buildSystemPrompt).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));
vi.mock('./workspaceContext.js', () => ({ loadWorkspaceContextSection: vi.fn(async () => '') }));
vi.mock('../../models/AgentModel.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../models/UserModel.js', () => ({ default: { getUserSettings: vi.fn(async () => ({})) } }));
vi.mock('../../models/AgentMemoryModel.js', () => ({
  default: { searchRelevant: vi.fn(async () => []), findByAgentId: vi.fn(async () => []), findByUserId: vi.fn(async () => []) },
}));
vi.mock('../../models/SkillModel.js', () => ({ default: { findAll: vi.fn(async () => []), findByIds: vi.fn(async () => []) } }));

import { getChatConfig } from './chatConfigs.js';
import { getAvailableToolSchemas } from './tools.js';
import AgentModel from '../../models/AgentModel.js';

const AGENT_ID = 'agent-inbox-triage';
const schema = (name) => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } });
const namesOf = (schemas) => schemas.map((s) => s.function.name);
const config = getChatConfig('agent');
const contextFor = () => ({ agentId: AGENT_ID, userId: 'user-1', latestUserMessage: 'triage my inbox' });

function installedAgent(assignedTools, toolAccessMode = 'restricted') {
  AgentModel.findOne.mockResolvedValue({
    id: AGENT_ID, name: 'Inbox Triage', description: 'Sorts mail.', systemPrompt: 'You triage email.',
    assignedTools, assignedSkills: [], toolAccessMode,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getAvailableToolSchemas.mockResolvedValue(['web_search', 'gmail_api', 'slack_api', 'notion_api', 'execute_shell_command'].map(schema));
});

describe('a restricted agent installed with website tool names', () => {
  it('is granted the registered tools its slugs name, inside its ceiling', async () => {
    installedAgent(['gmail', 'slack']);
    const ctx = contextFor();
    const tools = namesOf(await config.getToolSchemas(ctx));
    expect(tools).toEqual(expect.arrayContaining(['gmail_api', 'slack_api']));
    expect(ctx._toolCeiling.has('gmail_api')).toBe(true);
    expect(ctx._toolCeiling.has('slack_api')).toBe(true);
    // Still a ceiling: nothing it was not assigned.
    expect(tools).not.toContain('notion_api');
    expect(tools).not.toContain('execute_shell_command');
  });

  it('is told the names it really has, and which assigned tools are missing here', async () => {
    installedAgent(['gmail', 'slack', 'hubspot']);
    const ctx = contextFor();
    await config.getToolSchemas(ctx);
    const prompt = await config.buildSystemPrompt(ctx);
    expect(prompt).toContain('Your assigned toolset: gmail_api, slack_api');
    expect(prompt).toContain('Assigned but not available here: hubspot.');
    expect(prompt).not.toMatch(/assigned toolset: gmail[,\s]/);
  });

  it('says nothing about missing tools when everything resolved', async () => {
    installedAgent(['gmail', 'slack']);
    const ctx = contextFor();
    await config.getToolSchemas(ctx);
    expect(await config.buildSystemPrompt(ctx)).not.toContain('Assigned but not available here');
  });

  it('shows runtime names even when the prompt is built without the surface step', async () => {
    installedAgent(['gmail', 'slack']);
    const prompt = await config.buildSystemPrompt(contextFor());
    expect(prompt).toContain('Your assigned toolset: gmail_api, slack_api');
  });

  it('never reuses another agent\u2019s resolution left on a shared context', async () => {
    installedAgent(['gmail']);
    const ctx = { ...contextFor(), _assignedTools: { agentId: 'someone-else', resolved: ['execute_shell_command'], missing: ['x'] } };
    const prompt = await config.buildSystemPrompt(ctx);
    // The platform prompt names execute_shell_command elsewhere; judge the toolset line only.
    const toolsetLine = prompt.split('\n').find((l) => l.startsWith('Your assigned toolset:'));
    expect(toolsetLine).toMatch(/^Your assigned toolset: gmail_api \u2014 /);
    expect(prompt).not.toContain('Assigned but not available here');
  });
});

describe('an open-mode agent installed with website tool names', () => {
  it('pins the registered tools its slugs name', async () => {
    installedAgent(['notion'], 'open');
    const tools = namesOf(await config.getToolSchemas(contextFor()));
    expect(tools).toContain('notion_api');
  });
});

describe('agents that already use runtime names are unchanged', () => {
  it('grants exactly the assigned runtime tools', async () => {
    installedAgent(['gmail_api']);
    const ctx = contextFor();
    const tools = namesOf(await config.getToolSchemas(ctx));
    expect(tools).toContain('gmail_api');
    expect(tools).not.toContain('slack_api');
    expect(ctx._assignedTools).toEqual({ agentId: AGENT_ID, resolved: ['gmail_api'], missing: [] });
  });
});
