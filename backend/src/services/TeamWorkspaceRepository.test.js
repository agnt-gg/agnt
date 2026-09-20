import {it,expect} from 'vitest';
import sqlite3 from 'sqlite3';
import {TeamRepository} from './TeamRepository.js';
import {initializeTeamWorkspaces,TeamWorkspaceRepository} from './TeamWorkspaceRepository.js';
it('isolates workspaces, revisions, private close preferences and resource references',async()=>{
 const db=new sqlite3.Database(':memory:');const r=new TeamRepository(db);await r.ready;await initializeTeamWorkspaces(r);
 try{
 const team=await r.create('owner','owner@example.test','Team');const other=await r.create('other','other@example.test','Other');
 const invite=await r.invite(team.id,'owner','member@example.test','member');await r.accept('member','member@example.test',invite.token);
 const w=new TeamWorkspaceRepository(r);const workspace=await w.create(team.id,'owner','Engineering');
 expect((await w.list(team.id,'member'))[0].name).toBe('Engineering');
 await w.close(team.id,'member',workspace.id,false);
 expect((await w.list(team.id,'member'))[0].is_open).toBe(0);expect((await w.list(team.id,'owner'))[0].is_open).toBe(1);
 await w.update(team.id,'owner',workspace.id,{name:'Product',expectedRevision:1,canvas:[]});
 await expect(w.update(team.id,'member',workspace.id,{name:'Stale',expectedRevision:1})).rejects.toMatchObject({status:409});
 await expect(w.update(other.id,'other',workspace.id,{expectedRevision:2})).rejects.toMatchObject({status:404});
 const asset=await r.save(team.id,'owner',{name:'Brief',kind:'text',content:'hello'});await w.attach(team.id,'member',workspace.id,asset.id);expect((await w.resources(team.id,'owner',workspace.id))[0].id).toBe(asset.id);
 const foreign=await r.save(other.id,'other',{name:'Private',kind:'text',content:'private'});await expect(w.attach(team.id,'owner',workspace.id,foreign.id)).rejects.toMatchObject({status:404});
 await expect(w.archive(team.id,'member',workspace.id)).rejects.toMatchObject({status:403});await w.archive(team.id,'owner',workspace.id);expect(await w.list(team.id,'owner')).toEqual([]);
 }finally{await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));}
});
