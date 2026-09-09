import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../models/database/index.js', () => ({ default: {} }));
vi.mock('../../models/GoalModel.js', () => ({ default: {} }));
vi.mock('../../models/TaskModel.js', () => ({ default: {} }));
vi.mock('../../models/GoalIterationModel.js', () => ({ default: {} }));
vi.mock('./AgentTaskMatcher.js', () => ({ default: {} }));
vi.mock('./GoalEvaluator.js', () => ({ default: {} }));
vi.mock('./GoalProcessor.js', () => ({ default: {} }));
vi.mock('./SkillForgeOrchestrator.js', () => ({ default: {} }));
vi.mock('../evolution/InsightTriggers.js', () => ({ default: {} }));
vi.mock('../ai/LlmExecutionService.js', () => ({ default: { executeWithTools: vi.fn() } }));
vi.mock('../orchestrator/agentRuntime.js', () => ({ buildAgentRuntime: vi.fn() }));
vi.mock('../ai/LlmService.js', () => ({ createLlmClient: vi.fn() }));
vi.mock('../orchestrator/llmAdapters.js', () => ({ createLlmAdapter: vi.fn() }));
vi.mock('../ai/providerConfigs.js', () => ({ getProviderConfig: vi.fn() }));
vi.mock('../AutonomousMessageService.js', () => ({ default: {} }));
vi.mock('../cluster/nodeIdentity.js', () => ({ getNodeId: vi.fn() }));
vi.mock('../cluster/admission.js', () => ({ checkSpendAdmission: vi.fn() }));
vi.mock('../../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn(), RealtimeEvents: {} }));

import TaskOrchestrator from './TaskOrchestrator.js';
import service from '../ai/LlmExecutionService.js';
import { buildAgentRuntime } from '../orchestrator/agentRuntime.js';

beforeEach(() => {
  vi.clearAllMocks();
  service.executeWithTools.mockResolvedValue({ content: 'Done', toolExecutions: [], usage: null });
});

describe('goal/run_agent runtime context handoff', () => {
  it('preserves discovery state, resolved ceiling and prompt metadata while keeping trusted caller identity', async () => {
    const tools = [{ type: 'function', function: { name: 'discover_tools' } }];
    const context = {
      _toolCeiling: new Set(['discover_tools', 'read_file']),
      enabledTools: new Set(['read_file']),
      _loadedToolGroups: new Set(['core']),
      _loadedToolNames: new Set(['read_file']),
      _requestedToolCategories: new Set(),
      _frozenPromptGates: ['file-guidance'],
      _toolOrder: ['discover_tools'],
      _pinnedToolNames: ['discover_tools'],
      toolSchemas: tools,
      asyncEnabled: false,
      userId: 'stale-user', agentId: 'stale-agent', agentName: 'stale-name',
    };
    buildAgentRuntime.mockResolvedValue({ systemPrompt: 'Runtime prompt', toolSchemas: tools, context });
    const signal = new AbortController().signal;
    const ledger = { origin: 'goal_task', originId: 'task-1', executionId: 'execution-1' };
    const result = await TaskOrchestrator.executeTaskViaAgentChat({ id: 'agent-1', name: 'Worker' }, 'Task text', 'owner-1', 'openai', 'model-1', signal, ledger);
    expect(buildAgentRuntime).toHaveBeenCalledExactlyOnceWith({ agentId: 'agent-1', userId: 'owner-1', latestUserMessage: 'Task text', provider: 'openai' });
    const config = service.executeWithTools.mock.calls[0][0];
    expect(config.context).toEqual({ ...context, userId: 'owner-1', agentId: 'agent-1', agentName: 'Worker' });
    expect(config.context._toolCeiling).toBe(context._toolCeiling);
    expect(config.context).not.toBe(context);
    expect(context.userId).toBe('stale-user');
    expect(config.toolSchemas).toBe(tools);
    expect(config.systemPrompt).toBe('Runtime prompt');
    expect(config.signal).toBe(signal);
    expect(config.ledger).toBe(ledger);
    expect(config.maxToolRounds).toBe(10);
    expect(result).toEqual({ content: 'Done', tool_executions: [], usage: null });
  });

  it('retains the run_agent/system ledger default and propagates runtime errors', async () => {
    buildAgentRuntime.mockResolvedValue({ systemPrompt: 'Prompt', toolSchemas: [], context: { _toolCeiling: new Set() } });
    await TaskOrchestrator.executeTaskViaAgentChat({ id: 'a', name: 'A', provider: 'openai', model: 'test' }, 'task', 'u');
    expect(service.executeWithTools.mock.calls[0][0].ledger).toEqual({ origin: 'system', originId: null });
    expect(service.executeWithTools.mock.calls[0][0].context._toolCeiling.size).toBe(0);
    buildAgentRuntime.mockRejectedValue(new Error('runtime unavailable'));
    await expect(TaskOrchestrator.executeTaskViaAgentChat({ id: 'a', name: 'A' }, 'task', 'u', 'openai', 'test')).rejects.toThrow('runtime unavailable');
    expect(service.executeWithTools).toHaveBeenCalledTimes(1);
  });
});
