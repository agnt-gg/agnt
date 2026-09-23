import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../models/database/index.js', () => ({ default: {} }));
vi.mock('../../models/GoalModel.js', () => ({ default: {} }));
vi.mock('../../models/TaskModel.js', () => ({ default: {updateStatus:vi.fn()} }));
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
import TaskModel from '../../models/TaskModel.js';
import { buildAgentRuntime } from '../orchestrator/agentRuntime.js';

beforeEach(() => {
  vi.clearAllMocks();
  service.executeWithTools.mockResolvedValue({ content: 'Done', toolExecutions: [], usage: null });
});

describe('goal outcome regressions',()=>{
 it('Given the overnight blocked response, Then never mark completed and preserve output',async()=>{
  const content='## Status: Blocked — required local tools unavailable\nI could not read the mission file.';
  await expect(TaskOrchestrator.processTaskResult('t',{content,tool_executions:[]})).rejects.toThrow(/blocked/i);
  expect(TaskModel.updateStatus.mock.calls.some(c=>c[1]==='completed')).toBe(false);
  expect(TaskModel.updateStatus.mock.calls[0][1]).toBe('failed');
  expect(TaskModel.updateStatus.mock.calls[0][6].content).toBe(content);
 });
 it('Given structured failed outcome, Then reject even if text says done',async()=>{
  await expect(TaskOrchestrator.processTaskResult('t',{success:false,content:'Done',tool_executions:[]})).rejects.toThrow();
 });
 it('Given normal text-only output, Then do not require arbitrary tool calls',async()=>{
  await TaskOrchestrator.processTaskResult('t',{content:'The requested summary.',tool_executions:[]});
  expect(TaskModel.updateStatus.mock.calls[0][1]).toBe('completed');
 });
 it('Given built-in executor, Then pass trusted virtual config not just a missing saved ID',async()=>{
  buildAgentRuntime.mockResolvedValue({systemPrompt:'x',toolSchemas:[],context:{}});
  const agent={id:'built-in-task-executor',isBuiltIn:true,assignedTools:['read_file'],name:'Task Executor'};
  await TaskOrchestrator.executeTaskViaAgentChat(agent,'read fixture','u','openai','test');
  expect(buildAgentRuntime.mock.calls[0][0].builtInAgent).toEqual(agent);
 });
});
