import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
vi.mock('./Middleware.js',()=>({authenticateToken:(req,res,next)=>{const user=req.headers['x-test-user'];if(!user)return res.status(401).json({error:'auth'});req.user={id:user,userId:user};next();}}));
vi.mock('../utils/authGuard.js', () => ({ requireAuthHeader: (req,res,next) => req.user?.userId ? next() : res.status(401).json({error:'auth'}) }));
vi.mock('../plugins/PluginInstaller.js',()=>({default:{getInstalledPlugins:vi.fn(async()=>[{name:'alice-private',version:'1'},{name:'shared',version:'1'}]),getAvailablePlugins:vi.fn(async()=>({success:true,plugins:[]})),uninstallPlugin:vi.fn(async()=>({success:true})),getStats:()=>({})}}));
vi.mock('../plugins/PluginManager.js',()=>({default:{getStats:()=>({}),getPlugin:vi.fn(),getAllPluginSchemas:()=>[{type:'alice-tool',_plugin:'alice-private'},{type:'shared-tool',_plugin:'shared'}]}}));
vi.mock('../plugins/reloadAllPlugins.js',()=>({default:async()=>({success:true})}));
import db,{dbReady} from '../models/database/index.js';
import PluginAccounts from '../plugins/PluginAccountStore.js';
import PluginInstaller from '../plugins/PluginInstaller.js';
import routes from './PluginRoutes.js';
let server,base;
const alice='alice-'+randomUUID(),bob='bob-'+randomUUID();
beforeAll(async()=>{
 await dbReady;await PluginAccounts.ready();
 await PluginAccounts.run('INSERT INTO users(id,email) VALUES(?,?),(?,?)',[alice,alice+'@test',bob,bob+'@test']);
 await PluginAccounts.add('alice-private',alice);await PluginAccounts.add('shared',alice);await PluginAccounts.add('shared',bob);
 for(const user of [alice,bob])await PluginAccounts.run("INSERT INTO installed_plugin_assets(plugin_name,plugin_version,asset_type,asset_slug,local_id,user_id) VALUES('shared','1','tool','shared-tool','shared-tool',?)",[user]);
 const app=express();app.use(express.json());app.use('/plugins',routes);server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port+'/plugins';
});
afterAll(()=>new Promise(resolve=>server.close(resolve)));
const call=async(user,path,method='GET',body)=>{const response=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(user?{'x-test-user':user,Authorization:'Bearer fixture'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:await response.json()}};
describe('Real plugin route account boundary',()=>{
 it('requires authentication even for installed listing',async()=>expect((await call(null,'/installed')).status).toBe(401));
 it('shows only packages and tools installed for the caller',async()=>{
  expect((await call(bob,'/installed')).body.plugins.map(p=>p.name)).toEqual(['shared']);
  expect((await call(alice,'/installed')).body.plugins).toHaveLength(2);
  const tools=await call(bob,'/tools');expect(JSON.stringify(tools.body)).not.toContain('alice-tool');
 });
 it.each(['/installed/alice-private','/installed/alice-private/source','/installed/alice-private/package','/alice-private/assets'])('rejects another account reading %s before resolving the resource',async path=>expect((await call(bob,path)).status).toBe(404));
 it('scopes shared asset inventories to one account',async()=>{
  expect((await call(bob,'/shared/assets')).body.assets).toHaveLength(1);
 });
 it('rejects generated code replacing another account’s package before running a build', async () => {
   expect((await call(bob,'/build-generated','POST',{manifest:{name:'alice-private'}})).status).toBe(409);
 });
 it('rejects a bundle containing another account’s private asset', async () => {
   expect((await call(bob,'/bundle-from-assets','POST',{pluginName:'new-pack',selection:{agentIds:['missing-or-not-owned']}})).status).toBe(404);
 });
 it('rejects deleting another owner and preserves shared code when one owner uninstalls',async()=>{
  expect((await call(bob,'/alice-private','DELETE')).status).toBe(404);
  expect((await call(bob,'/shared','DELETE')).body.success).toBe(true);
  expect(PluginInstaller.uninstallPlugin).not.toHaveBeenCalled();
  expect(await PluginAccounts.has('shared',alice)).toBe(true);expect(await PluginAccounts.has('shared',bob)).toBe(false);
  expect(await PluginAccounts.all("SELECT * FROM installed_plugin_assets WHERE plugin_name='shared' AND user_id=?",[alice])).toHaveLength(1);
 });
});
