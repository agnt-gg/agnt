/**
 * A goal task that needs Gmail must be able to pick an agent installed from
 * agnt.gg with the website slug "gmail" rather than "gmail_api" - and aliasing
 * may only ever ADD a match, never take one away.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/AgentModel.js', () => ({ default: { findAllByUserId: vi.fn() } }));
vi.mock('../orchestrator/tools.js', () => ({ getAvailableToolSchemas: vi.fn() }));

import AgentTaskMatcher from './AgentTaskMatcher.js';
import AgentModel from '../../models/AgentModel.js';
import { getAvailableToolSchemas } from '../orchestrator/tools.js';

const schema = (name) => ({ type: 'function', function: { name } });
const BUILT_IN = { id: 'built-in-task-executor', isBuiltIn: true };
const task = (required) => ({ title: 'Sort the inbox', description: '', required_tools: required });
const legacy = { id: 'a-legacy', name: 'Inbox Triage', assignedTools: ['gmail', 'slack'], category: 'Business' };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(AgentTaskMatcher, 'getBuiltInTaskExecutor').mockResolvedValue(BUILT_IN);
  getAvailableToolSchemas.mockResolvedValue([schema('gmail_api'), schema('slack_api'), schema('web_search')]);
});

describe('AgentTaskMatcher with legacy tool names', () => {
  it('selects the legacy agent for a task that needs gmail_api', async () => {
    AgentModel.findAllByUserId.mockResolvedValue([legacy]);
    expect(await AgentTaskMatcher.selectAgentForTask(task(['gmail-api']), 'u1')).toBe(legacy);
  });

  it('does not invent a match when the runtime tool is not registered', async () => {
    getAvailableToolSchemas.mockResolvedValue([schema('web_search')]);
    AgentModel.findAllByUserId.mockResolvedValue([legacy]);
    expect(await AgentTaskMatcher.selectAgentForTask(task(['gmail_api']), 'u1')).toBe(BUILT_IN);
  });

  it('keeps matching on stored names when the registry cannot be read', async () => {
    getAvailableToolSchemas.mockRejectedValue(new Error('registry down'));
    const runtimeNamed = { id: 'a-new', name: 'New', assignedTools: ['gmail_api'] };
    AgentModel.findAllByUserId.mockResolvedValue([runtimeNamed]);
    expect(await AgentTaskMatcher.selectAgentForTask(task(['gmail_api']), 'u1')).toBe(runtimeNamed);
  });

  it('still matches a stored name the registry does not list (aliasing only adds)', async () => {
    const custom = { id: 'a-custom', name: 'Custom', assignedTools: ['tool-prom-query'] };
    AgentModel.findAllByUserId.mockResolvedValue([custom]);
    expect(await AgentTaskMatcher.selectAgentForTask(task(['tool_prom_query']), 'u1')).toBe(custom);
  });
});
