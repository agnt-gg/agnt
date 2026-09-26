import { describe,it,expect,vi,afterEach } from 'vitest';
vi.mock('@/tt.config.js',()=>({API_CONFIG:{BASE_URL:'http://fixture/api'}}));
vi.hoisted(()=>{const data=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),clear:()=>data.clear()}});});
import { createStore } from 'vuex';
import goals from './goals.js';
const storeFor=()=>createStore({modules:{goals:{...goals,state:()=>({...goals.state,goals:[]})}}});
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();});
const reply=(status,body,json=true)=>vi.fn(async()=>({ok:status<300,status,json:async()=>{if(!json)throw new SyntaxError('not json');return body;}}));

describe('Given goal creation fails on the server',()=>{
 it('When planning failed Then reject with the server message, code and retry hint',async()=>{
  localStorage.setItem('token','fixture');
  vi.stubGlobal('fetch',reply(502,{error:'OpenAI (gpt-fixture) could not be reached: Connection error.',code:'PLANNER_UNAVAILABLE',provider:'openai',model:'gpt-fixture',reason:'Connection error.',retryable:true}));
  const s=storeFor();
  const e=await s.dispatch('goals/createGoal',{text:'Summarize'}).catch(x=>x);
  expect(e).toBeInstanceOf(Error);
  expect(e.message).toBe('OpenAI (gpt-fixture) could not be reached: Connection error.');
  expect(e).toMatchObject({code:'PLANNER_UNAVAILABLE',retryable:true,provider:'openai',model:'gpt-fixture',status:502});
  expect(s.state.goals.goals).toHaveLength(0);
 });
 it('When the body is not JSON Then reject with a clear HTTP message',async()=>{
  localStorage.setItem('token','fixture');
  vi.stubGlobal('fetch',reply(500,null,false));
  const e=await storeFor().dispatch('goals/createGoal',{text:'Summarize'}).catch(x=>x);
  expect(e.message).toBe('Failed to create goal (HTTP 500)');
  expect(e.retryable).toBe(false);
 });
});
