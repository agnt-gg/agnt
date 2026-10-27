import {describe,it,expect,vi,afterEach} from 'vitest';
vi.mock('./PluginAccountStore.js',()=>({default:{ready:async()=>{},owners:async()=>[],assert:async()=>{}}}));
import {pluginAccountBoundary} from './pluginAccountRoutes.js';
afterEach(()=>vi.unstubAllEnvs());
describe('hosted extension administration',()=>{
 it('a member or team admin cannot install backend code',async()=>{
  vi.stubEnv('AGNT_TENANT_SLUG','bravo');vi.stubEnv('AGNT_TENANT_OWNER','owner');
  const next=vi.fn();const res={status:vi.fn().mockReturnThis(),json:vi.fn()};
  await pluginAccountBoundary({method:'POST',path:'/install-file',user:{id:'member'},body:{}},res,next);
  expect(res.status).toHaveBeenCalledWith(403);expect(next).not.toHaveBeenCalled();
 });
 it('a member may only ask to switch on a marketplace package, and that request is marked activation-only',async()=>{
  vi.stubEnv('AGNT_TENANT_SLUG','bravo');vi.stubEnv('AGNT_TENANT_OWNER','owner');
  const next=vi.fn();const res={status:vi.fn().mockReturnThis(),json:vi.fn()};
  const req={method:'POST',path:'/install',user:{id:'member'},body:{name:'gmail-plugin'}};
  await pluginAccountBoundary(req,res,next);
  expect(next).toHaveBeenCalledOnce();expect(req.memberActivationOnly).toBe(true);
  for(const path of ['/install-github','/build-generated','/bundle-from-assets','/reload']){
   const r={status:vi.fn().mockReturnThis(),json:vi.fn()};const n=vi.fn();
   await pluginAccountBoundary({method:'POST',path,user:{id:'member'},body:{}},r,n);
   expect(r.status,path).toHaveBeenCalledWith(403);expect(n,path).not.toHaveBeenCalled();
  }
 });
 it('the owner retains explicit extension installation',async()=>{
  vi.stubEnv('AGNT_TENANT_SLUG','bravo');vi.stubEnv('AGNT_TENANT_OWNER','owner');
  const next=vi.fn();const res={status:vi.fn().mockReturnThis(),json:vi.fn()};
  const req={method:'POST',path:'/install',user:{id:'owner'},body:{name:'gmail-plugin'}};
  await pluginAccountBoundary({method:'POST',path:'/install-file',user:{id:'owner'},body:{}},res,next);
  await pluginAccountBoundary(req,res,next);
  expect(next).toHaveBeenCalledTimes(2);expect(req.memberActivationOnly).toBeUndefined();
 });
});
