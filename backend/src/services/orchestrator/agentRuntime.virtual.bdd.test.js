import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('./tools.js',()=>({getAvailableToolSchemas:vi.fn()}));
vi.mock('./workspaceContext.js',()=>({loadWorkspaceContextSection:async()=>''}));
vi.mock('../../models/AgentModel.js',()=>({default:{findOne:vi.fn()}}));
vi.mock('../../models/UserModel.js',()=>({default:{getUserSettings:async()=>({})}}));
vi.mock('../../models/AgentMemoryModel.js',()=>({default:{findRelevant:async()=>[],findByAgentId:async()=>[],findByUserId:async()=>[]}}));
vi.mock('../../models/SkillModel.js',()=>({default:{findAll:async()=>[],findByIds:async()=>[]}}));
import {buildAgentRuntime} from './agentRuntime.js';
import {getAvailableToolSchemas} from './tools.js';
import AgentModel from '../../models/AgentModel.js';
const USER_ID='virtual-test-user';
const schema=name=>({type:'function',function:{name,description:name,parameters:{type:'object',properties:{}}}});
beforeEach(()=>{vi.clearAllMocks();AgentModel.findOne.mockResolvedValue(null);getAvailableToolSchemas.mockResolvedValue(['read_file','write_file','execute_shell_command','send_email','discover_tools'].map(schema));});
describe('virtual goal worker runtime',()=>{
 it('Given no saved worker row, Then preserve declared tools without adding unrelated tools',async()=>{
  const worker={id:'built-in-task-executor',isBuiltIn:true,name:'Task Executor',assignedTools:['read_file','write_file','execute_shell_command'],toolAccessMode:'restricted'};
  const runtime=await buildAgentRuntime({agentId:worker.id,userId:USER_ID,builtInAgent:worker,latestUserMessage:'read file'});
  const names=new Set(runtime.toolSchemas.map(s=>s.function.name));
  for(const name of worker.assignedTools)expect(names.has(name)).toBe(true);
  expect(runtime.context._toolCeiling.has('send_email')).toBe(false);
 });
 it('Given a missing declared virtual tool, Then fail before model execution',async()=>{
  await expect(buildAgentRuntime({agentId:'built-in-task-executor',userId:USER_ID,builtInAgent:{id:'built-in-task-executor',isBuiltIn:true,assignedTools:['missing-tool']}})).rejects.toThrow(/tools unavailable/);
 });
 it('Given browser-like context fields claiming a virtual agent, Then never grant virtual tools',async()=>{
  const runtime=await buildAgentRuntime({agentId:'built-in-task-executor',userId:USER_ID,contextOverrides:{builtInAgent:{assignedTools:['execute_shell_command']},isBuiltIn:true}});
  expect(runtime.toolSchemas.some(s=>s.function.name==='execute_shell_command')).toBe(false);
 });
});
