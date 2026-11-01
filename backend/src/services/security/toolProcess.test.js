import {describe,it,expect,vi,afterEach,beforeEach} from 'vitest';
import fs from 'node:fs';
import {sandboxPlan,toolRootFor} from './toolProcess.js';
afterEach(()=>vi.restoreAllMocks());
const OWNER_ROOT='/app/data/projects',MEMBER_ROOT='/app/data/workspaces/member-2';
const hostedWith=(root,extra={})=>({hosted:true,actor:'u',networkFactory:()=>({socketPath:'/private/run',close:()=>{}}),issueProxyKey:()=>'k',workspaceFor:()=>root,ensureDir:()=>{},...extra});
describe('hosted process launch plan',()=>{
 it('leaves desktop execution unchanged',()=>{
  const options={cwd:'C:/work',env:{EXPLICIT:'yes'},shell:true};const result=sandboxPlan('echo',['ok'],options,{hosted:false});expect(result).toEqual({command:'echo',args:['ok'],options});
 });
 it('fails closed if the launcher is absent',()=>{
  vi.spyOn(fs,'existsSync').mockReturnValue(false);expect(()=>sandboxPlan('node',[],{}, {hosted:true})).toThrow(/unavailable/);
 });
 it('passes the run proxy key, never server env, NODE_OPTIONS, the full bearer or a caller-chosen socket',()=>{
  vi.spyOn(fs,'existsSync').mockReturnValue(true);
  // Paths are Linux-specific in production; the cwd-less case uses a fixed root.
  const factory=vi.fn(()=>({socketPath:'/private/run',close:()=>{}}));
  const issueProxyKey=vi.fn(()=>'agnt-tool.proxy-key');
  const result=sandboxPlan('node',['-e','1'],{timeout:120000,env:{JWT_SECRET:'S',NODE_OPTIONS:'--require=bad',AGNT_AUTH_TOKEN:'FULL',AGNT_TOOL_SOCKET:'ATTACKER',AGNT_TOOL_WORKSPACE:'/'}},hostedWith(OWNER_ROOT,{actor:'verified-user',networkFactory:factory,issueProxyKey}));
  expect(result.options.env).toEqual({PATH:'/usr/local/bin:/usr/bin:/bin',AGNT_TOOL_WORKSPACE:OWNER_ROOT,AGNT_TOOL_SOCKET:'/private/run',AGNT_AUTH_TOKEN:'agnt-tool.proxy-key'});
  expect(issueProxyKey).toHaveBeenCalledWith('verified-user',{ttlSeconds:120});
  expect(factory.mock.calls[0][0]).toBe('verified-user');expect(result.options.shell).toBe(false);
 });
 it('an internal run with no actor gets no proxy key',()=>{
  vi.spyOn(fs,'existsSync').mockReturnValue(true);
  const issueProxyKey=vi.fn(()=>'agnt-tool.proxy-key');
  const result=sandboxPlan('node',[],{},hostedWith(OWNER_ROOT,{actor:undefined,issueProxyKey}));
  expect(result.options.env.AGNT_AUTH_TOKEN).toBeUndefined();expect(issueProxyKey).not.toHaveBeenCalled();
 });
 it('a key that cannot be issued never blocks the run',()=>{
  vi.spyOn(fs,'existsSync').mockReturnValue(true);vi.spyOn(console,'error').mockImplementation(()=>{});
  const result=sandboxPlan('node',[],{},hostedWith(OWNER_ROOT,{issueProxyKey:()=>{throw new Error('no secret');}}));
  expect(result.options.env.AGNT_AUTH_TOKEN).toBeUndefined();expect(console.error).toHaveBeenCalled();
 });
});
// Bravo, 2026-10-31: the owner's chat resolved /app/data/workspaces/<owner> and every code tool failed;
// with members allowed to run code, a fixed /app/data/projects mount would have exposed the owner's files.
describe('each hosted run sees only its own workspace',()=>{
 beforeEach(()=>vi.spyOn(fs,'existsSync').mockReturnValue(true));
 it('the owner runs in the install folder by default and in any folder inside it',()=>{
  expect(sandboxPlan('ls',[],{},hostedWith(OWNER_ROOT)).options.cwd).toBe(OWNER_ROOT);
  expect(sandboxPlan('ls',[],{cwd:'/app/data/projects/site'},hostedWith(OWNER_ROOT)).options.cwd).toBe('/app/data/projects/site');
 });
 it('a member runs in their own folder, which the launcher is told to mount, and it is created first',()=>{
  const ensureDir=vi.fn();const plan=sandboxPlan('ls',[],{},hostedWith(MEMBER_ROOT,{ensureDir}));
  expect(plan.options.cwd).toBe(MEMBER_ROOT);expect(plan.options.env.AGNT_TOOL_WORKSPACE).toBe(MEMBER_ROOT);expect(ensureDir).toHaveBeenCalledWith(MEMBER_ROOT);
 });
 it('a relative cwd resolves inside the caller\'s folder',()=>{
  expect(sandboxPlan('ls',[],{cwd:'sub/dir'},hostedWith(MEMBER_ROOT)).options.cwd).toBe(MEMBER_ROOT+'/sub/dir');
 });
 it('a member cannot point cwd at the owner\'s folder, another member\'s, or escape with ..',()=>{
  for(const cwd of [OWNER_ROOT,'/app/data/projects/secret','/app/data/workspaces/member-3','../member-3','/app/data','/']){
   expect(()=>sandboxPlan('ls',[],{cwd},hostedWith(MEMBER_ROOT)),cwd).toThrow(/inside the workspace/);
  }
 });
 it('a folder the launcher cannot mount fails closed',()=>{
  for(const root of ['/app/data','/app/data/workspaces/a/b','/app/data/workspaces/../projects2','/etc','/app/data/projects-other']){
   expect(()=>toolRootFor('u',()=>root),root).toThrow(/cannot mount|inside the workspace/);
  }
 });
});
