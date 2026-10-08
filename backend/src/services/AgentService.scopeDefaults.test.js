import {describe,it,expect,vi,beforeEach} from 'vitest';
vi.mock('./OrchestratorService.js',()=>({default:vi.fn()}));
vi.mock('../models/database/index.js',()=>({default:{run:(_sql,_args,done)=>done()}}));
vi.mock('../models/UserModel.js',()=>({default:{getUserSettings:vi.fn()}}));
vi.mock('../models/AgentModel.js',()=>({default:{findOne:vi.fn(),createOrUpdate:vi.fn()}}));
vi.mock('../utils/realtimeSync.js',()=>({broadcast:vi.fn(),broadcastToUser:vi.fn(),RealtimeEvents:{AGENT_CREATED:'created',AGENT_UPDATED:'updated'}}));
import AgentService from './AgentService.js';
import AgentModel from '../models/AgentModel.js';
import UserModel from '../models/UserModel.js';
import {withScopeRequest} from './authorization/ScopeRequestContext.js';
const defaults={selectedProvider:'Claude-Code',selectedModel:'claude-opus-5-5'};
const response=()=>({status:vi.fn().mockReturnThis(),json:vi.fn()});
beforeEach(()=>{vi.clearAllMocks();AgentModel.findOne.mockResolvedValue(null);AgentModel.createOrUpdate.mockResolvedValue({});UserModel.getUserSettings.mockImplementation(async id=>id==='actor'?defaults:{});});
describe('agent defaults preserve actor vs storage ownership',()=>{
 it('creates a shared agent from actor preferences, storing it under the workspace principal',async()=>{
  const req={user:{userId:'workspace-owner'},body:{agent:{name:'Research Analyst'}}};const res=response();
  await withScopeRequest(req,{actorId:'actor',resourceOwnerId:'workspace-owner'},()=>AgentService.saveOrUpdateAgent(req,res));
  expect(res.status).toHaveBeenCalledWith(200);
  expect(UserModel.getUserSettings).toHaveBeenCalledWith('actor');
  expect(AgentModel.createOrUpdate).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({provider:defaults.selectedProvider,model:defaults.selectedModel}),'workspace-owner');
 });
 it('retains personal creation and ignores caller-supplied actor fields',async()=>{
  const req={user:{userId:'actor'},scopeContext:{actorId:'stranger'},body:{actorId:'stranger',agent:{name:'Personal'}}};const res=response();
  await AgentService.saveOrUpdateAgent(req,res);
  expect(res.status).toHaveBeenCalledWith(200);expect(UserModel.getUserSettings).toHaveBeenCalledWith('actor');
  expect(AgentModel.createOrUpdate.mock.calls[0][2]).toBe('actor');
 });
 it('does not replace an explicitly configured provider/model',async()=>{
  const req={user:{userId:'workspace-owner'},body:{agent:{name:'Explicit',provider:'local',model:'chosen-model'}}};const res=response();
  await withScopeRequest(req,{actorId:'actor'},()=>AgentService.saveOrUpdateAgent(req,res));
  expect(res.status).toHaveBeenCalledWith(200);expect(UserModel.getUserSettings).not.toHaveBeenCalled();
  expect(AgentModel.createOrUpdate.mock.calls[0][1].model).toBe('chosen-model');
 });
});
