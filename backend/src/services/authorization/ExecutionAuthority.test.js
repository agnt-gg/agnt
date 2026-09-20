import {it,expect,vi} from 'vitest';
import sqlite3 from 'sqlite3';
import {initializeOwnershipSchema} from './OwnershipSchema.js';
import {initializeExecutionAuthority,ExecutionAuthority} from './ExecutionAuthority.js';
it('persists principals without credentials and checks grants and revocation before execution',async()=>{
 const db=new sqlite3.Database(':memory:');const repository={run:(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this)})),all:(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(e,v)=>e?reject(e):resolve(v))),get:(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(e,v)=>e?reject(e):resolve(v)))};
 try{
 await repository.run('PRAGMA foreign_keys=ON');await initializeOwnershipSchema(repository,[]);await initializeExecutionAuthority(repository);
 await repository.run("INSERT INTO ownership_scopes(id,kind,team_id) VALUES('workspace','workspace','team')");
 const authorize=vi.fn(async()=>{});const broker={execute:vi.fn(async()=>({ok:true}))};const authority=new ExecutionAuthority(repository,authorize,broker);const context={actorId:'owner'};
 const principal=await authority.createPrincipal(context,'workspace','Scheduled report');
 await repository.run("INSERT INTO scoped_connections VALUES('connection','workspace','github','remote-ref','owner','active')");
 await expect(authority.execute(context,principal.id,'connection',{})).rejects.toMatchObject({status:403});expect(broker.execute).not.toHaveBeenCalled();
 await authority.grantConnection(context,principal.id,'connection');await authority.execute(context,principal.id,'connection',{name:'list'});expect(broker.execute).toHaveBeenCalledOnce();
 expect(broker.execute.mock.calls[0][0]).toMatchObject({principalId:principal.id,scopeId:'workspace',connectionId:'remote-ref'});
 await authority.revoke(context,principal.id);await expect(authority.execute(context,principal.id,'connection',{})).rejects.toMatchObject({status:403});expect(broker.execute).toHaveBeenCalledOnce();
 }finally{await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));}
});
