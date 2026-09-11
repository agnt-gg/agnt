import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../models/database/index.js',()=>({default:{}}));
vi.mock('../../models/AgentModel.js',()=>({default:{findOne:vi.fn()}}));
vi.mock('../../models/AgentExecutionModel.js',()=>({default:{create:vi.fn(),update:vi.fn(),getRootFor:vi.fn()}}));
vi.mock('../goal/TaskOrchestrator.js',()=>({default:{executeTaskViaAgentChat:vi.fn()}}));
import Agent from '../../models/AgentModel.js';
import Execution from '../../models/AgentExecutionModel.js';
import Runner from '../goal/TaskOrchestrator.js';
import {AGENT_TOOLS} from './agentTools.js';
const metrics={boundary:'adapter_input_json_utf8',tokenCount:'not_measured',requests:[{requestIndex:1,messageBytes:60,schemaBytes:40,totalBytes:100,systemBytes:20,userBytes:30,toolBytes:0,assistantBytes:0}],peakBytes:100,aggregateBytes:100};
const telemetry={version:1,outcome:'completed',requestMetrics:metrics,usage:{inputTokens:8,outputTokens:2,totalTokens:10},usageCoverage:'complete',toolCalls:{started:1,finished:1,inFlight:0},effectDisposition:'tool_calls_observed_effects_not_verified'};
const invoke=async()=>JSON.parse(await AGENT_TOOLS.run_agent.execute({agentId:'a',parameters:{task:'fixture'}},null,{userId:'u'}));
beforeEach(()=>{vi.clearAllMocks();Agent.findOne.mockResolvedValue({id:'a',created_by:'u',name:'Fixture'});Execution.create.mockResolvedValue('e');Execution.update.mockResolvedValue(1);Runner.executeTaskViaAgentChat.mockResolvedValue({content:'done',tool_executions:[{name:'read_file'}],usage:telemetry.usage,requestMetrics:metrics,executionTelemetry:telemetry});});
describe('Given a saved-agent invocation',()=>{
 it('When successful Then return and persist the same versioned telemetry',async()=>{const r=await invoke();expect(r.executionTelemetry).toEqual(telemetry);expect(r.requestMetrics).toEqual(metrics);expect(Execution.update.mock.calls[0][7]).toEqual(telemetry);});
 it('When a model fails after a tool Then retain observed counts and partial measurements',async()=>{const partial={...telemetry,outcome:'failed',usageCoverage:'partial'};Runner.executeTaskViaAgentChat.mockRejectedValue(Object.assign(Error('provider failed'),{executionTelemetry:partial,toolExecutions:[{name:'write_file',response:'PRIVATE_PAYLOAD'}]}));const r=await invoke();expect(r.success).toBe(false);expect(r.toolCallsCount).toBe(1);expect(r.executionTelemetry).toEqual(partial);expect(Execution.update.mock.calls[0][4]).toBe(1);expect(Execution.update.mock.calls[0][7]).toEqual(partial);expect(JSON.stringify(r)).not.toContain('PRIVATE_PAYLOAD');});
 it('When failure has no measurements Then unknown is not a fabricated zero',async()=>{Runner.executeTaskViaAgentChat.mockRejectedValue(Error('unavailable'));const r=await invoke();expect(r.toolCallsCount).toBeNull();expect(r.executionTelemetry.usage).toBeNull();expect(r.executionTelemetry.usageCoverage).toBe('unknown');expect(Execution.update.mock.calls[0][4]).toBeNull();});
 it.each(['blocked','failed','pending'])('When transport returns %s Then do not publish completed',async status=>{Runner.executeTaskViaAgentChat.mockResolvedValue({content:'not delivered',status});const r=await invoke();expect(r.success).toBe(false);expect(Execution.update.mock.calls[0][1]).not.toBe('completed');});
 it('When telemetry persistence fails Then preserve the measured result and never rerun',async()=>{Execution.update.mockRejectedValue(Error('disk'));const r=await invoke();expect(r.success).toBe(false);expect(r.executionTelemetry).toEqual(telemetry);expect(r.persistence).toBe('unknown');expect(Execution.update).toHaveBeenCalledTimes(1);expect(Runner.executeTaskViaAgentChat).toHaveBeenCalledTimes(1);});
 it('When owner mismatches Then no execution is created',async()=>{Agent.findOne.mockResolvedValue({id:'a',created_by:'other'});expect((await invoke()).success).toBe(false);expect(Execution.create).not.toHaveBeenCalled();});
});

it('Given cancelled run Then persist stopped with cancellation telemetry',async()=>{const t={...telemetry,outcome:'cancelled',toolCalls:{started:1,finished:0,inFlight:1},effectDisposition:'in_flight_or_unknown'};Runner.executeTaskViaAgentChat.mockRejectedValue(Object.assign(Error('aborted'),{name:'AbortError',executionTelemetry:t}));const r=await invoke();expect(r.executionTelemetry.outcome).toBe('cancelled');expect(Execution.update.mock.calls[0][1]).toBe('stopped');expect(r.toolCallsCount).toBe(1);});
