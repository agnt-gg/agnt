import {describe,it,expect,vi,afterEach} from 'vitest';
import fs from 'node:fs';
import {sandboxPlan} from './toolProcess.js';
afterEach(()=>vi.restoreAllMocks());
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
  const result=sandboxPlan('node',['-e','1'],{timeout:120000,env:{JWT_SECRET:'S',NODE_OPTIONS:'--require=bad',AGNT_AUTH_TOKEN:'FULL',AGNT_TOOL_SOCKET:'ATTACKER'}},{hosted:true,actor:'verified-user',networkFactory:factory,issueProxyKey});
  expect(result.options.env).toEqual({PATH:'/usr/local/bin:/usr/bin:/bin',AGNT_TOOL_SOCKET:'/private/run',AGNT_AUTH_TOKEN:'agnt-tool.proxy-key'});
  expect(issueProxyKey).toHaveBeenCalledWith('verified-user',{ttlSeconds:120});
  expect(factory.mock.calls[0][0]).toBe('verified-user');expect(result.options.shell).toBe(false);
 });
 it('an internal run with no actor gets no proxy key',()=>{
  vi.spyOn(fs,'existsSync').mockReturnValue(true);
  const issueProxyKey=vi.fn(()=>'agnt-tool.proxy-key');
  const result=sandboxPlan('node',[],{},{hosted:true,actor:undefined,networkFactory:()=>({socketPath:'/private/run',close:()=>{}}),issueProxyKey});
  expect(result.options.env.AGNT_AUTH_TOKEN).toBeUndefined();expect(issueProxyKey).not.toHaveBeenCalled();
 });
 it('a key that cannot be issued never blocks the run',()=>{
  vi.spyOn(fs,'existsSync').mockReturnValue(true);vi.spyOn(console,'error').mockImplementation(()=>{});
  const result=sandboxPlan('node',[],{},{hosted:true,actor:'u',networkFactory:()=>({socketPath:'/private/run',close:()=>{}}),issueProxyKey:()=>{throw new Error('no secret');}});
  expect(result.options.env.AGNT_AUTH_TOKEN).toBeUndefined();expect(console.error).toHaveBeenCalled();
 });
});
