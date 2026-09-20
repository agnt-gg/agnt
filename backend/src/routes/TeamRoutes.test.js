import {describe,it,expect,vi,afterEach} from 'vitest';
import express from 'express';
import sqlite3 from 'sqlite3';
import {TeamRepository} from '../services/TeamRepository.js';
import {createTeamRouter} from './TeamRoutes.js';
afterEach(()=>vi.unstubAllEnvs());
async function fixture(run){
 const db=new sqlite3.Database(':memory:');const repository=new TeamRepository(db);await repository.ready;
 const roles=new Map([['owner','owner'],['member','member']]);
 const cloud={request:vi.fn(async()=>[{id:'team',name:'Example'}]),access:vi.fn(async(token,id)=>{const user=token?.replace('Bearer ','');if(id!=='team'||!roles.has(user))throw Object.assign(new Error('Team not found'),{status:404});return{id:'team',name:'Example',role:roles.get(user),tenantSlug:'example'};})};
 const app=express();app.use(express.json());app.use('/teams',createTeamRouter(()=>repository,(req,res,next)=>{const id=req.headers.authorization?.replace('Bearer ','');if(id)req.user={id};next();},cloud));
 const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
 const request=async(path='',method='GET',body,user='owner')=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/teams${path}`,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:'Bearer '+user}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,headers:response.headers,body:await response.json()};};
 try{await run({request,roles,cloud});}finally{await new Promise(resolve=>server.close(resolve));await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));}
}
describe('cloud-authorized team routes',()=>{
 it('requires identity and proxies management instead of creating local teams',()=>fixture(async({request,cloud})=>{expect((await request('','GET',null,null)).status).toBe(401);const result=await request('','POST',{tenantSlug:'example'});expect(result.status).toBe(200);expect(cloud.request).toHaveBeenCalled();expect(result.headers.get('cache-control')).toBe('no-store');}));
 it('requires the hosted instance for shared storage',()=>fixture(async({request})=>{vi.stubEnv('AGNT_TENANT_SLUG','');expect((await request('/team/assets')).status).toBe(409);}));
 it('uses live cloud membership on every asset request and shares revisions safely',()=>fixture(async({request,roles})=>{
 vi.stubEnv('AGNT_TENANT_SLUG','example');
 const created=await request('/team/assets','POST',{name:'Shared',kind:'text',content:'first'});expect(created.status).toBe(200);
 const id=created.body.id;expect(id).toBeTruthy();
 const edited=await request('/team/assets','POST',{id,name:'Shared',kind:'text',content:'second',expectedRevision:1},'member');expect(edited.status).toBe(200);
 expect((await request('/team/assets','POST',{id,name:'Shared',kind:'text',content:'stale',expectedRevision:1})).status).toBe(409);
 roles.delete('member');expect((await request('/team/assets/'+id,'GET',null,'member')).status).toBe(404);
 expect((await request('/team/assets/'+id)).body.content).toBe('second');
 }));
});
