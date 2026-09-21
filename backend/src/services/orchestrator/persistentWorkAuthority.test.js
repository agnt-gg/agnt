import {it,expect} from 'vitest';
import sqlite3 from 'sqlite3';
import {ConversationWorkModel} from '../../models/ConversationWorkModel.js';
import {PersistentWorkAuthority} from './persistentWorkAuthority.js';
it('persists encrypted authority, revalidates on every resolve, and respects revocation',async()=>{
 const database=new sqlite3.Database(':memory:');
 try{
  const store=new ConversationWorkModel(database);await store.initialize();
  const work=await store.create({conversationId:'chat',ownerId:'owner',objective:'Finish'});
  let valid=true,calls=0;
  const options={store,verifyCredential:async token=>{calls++;return {ok:valid&&token==='Bearer private',ownerId:'owner'};},authorizeScope:async()=>{},encode:text=>Buffer.from(text).toString('base64'),decode:text=>Buffer.from(text,'base64').toString()};
  const authority=new PersistentWorkAuthority(options);await authority.initialize();
  await authority.bind(work,{kind:'personal',binding:{scope:'personal'},credential:'Bearer private'});
  const saved=await store.get('SELECT credential FROM conversation_work_authority WHERE work_id=?',[work.id]);expect(saved.credential).not.toContain('private');
  const restarted=new PersistentWorkAuthority(options);
  expect((await restarted.resolve(work)).authToken).toBe('Bearer private');expect(calls).toBe(2);
  valid=false;await expect(restarted.resolve(work)).rejects.toMatchObject({code:'waiting_auth'});
  valid=true;await restarted.revoke(work);await expect(restarted.resolve(work)).rejects.toMatchObject({code:'waiting_permission'});
  expect((await store.find(work.id,'owner')).status).toBe('paused');
 }finally{await new Promise((resolve,reject)=>database.close(error=>error?reject(error):resolve()));}
});
