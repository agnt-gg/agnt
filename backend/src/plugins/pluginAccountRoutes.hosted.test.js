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
 it('the owner retains explicit extension installation',async()=>{
  vi.stubEnv('AGNT_TENANT_SLUG','bravo');vi.stubEnv('AGNT_TENANT_OWNER','owner');
  const next=vi.fn();const res={status:vi.fn().mockReturnThis(),json:vi.fn()};
  await pluginAccountBoundary({method:'POST',path:'/install-file',user:{id:'owner'},body:{}},res,next);
  expect(next).toHaveBeenCalledOnce();
 });
});
