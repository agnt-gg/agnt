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
 it('does not pass server env, NODE_OPTIONS, full bearer or a caller-chosen socket',()=>{
  vi.spyOn(fs,'existsSync').mockReturnValue(true);
  // Paths are Linux-specific in production; the cwd-less case uses a fixed root.
  const factory=vi.fn(()=>({socketPath:'/private/run',close:()=>{}}));
  const result=sandboxPlan('node',['-e','1'],{env:{JWT_SECRET:'S',NODE_OPTIONS:'--require=bad',AGNT_AUTH_TOKEN:'FULL',AGNT_TOOL_SOCKET:'ATTACKER'}},{hosted:true,actor:'verified-user',networkFactory:factory});
  expect(result.options.env).toEqual({PATH:'/usr/local/bin:/usr/bin:/bin',AGNT_TOOL_SOCKET:'/private/run'});expect(factory.mock.calls[0][0]).toBe('verified-user');expect(result.options.shell).toBe(false);
 });
});
