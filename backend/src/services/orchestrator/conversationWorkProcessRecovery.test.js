import {it,expect} from 'vitest';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function run(script,args){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[script,...args],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','pipe']});
 let output='',error='';const timer=setTimeout(()=>child.kill(),15000);
 child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{error+=chunk;});
 child.on('error',reject);child.on('close',code=>{clearTimeout(timer);code===0?resolve(JSON.parse(output)):reject(new Error(error||`Worker exited ${code}`));});
});}
it('another process reclaims expired work while persisted Stop remains paused',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'continuity-process-'));
 try{
  const script=path.join(directory,'worker.mjs');const database=path.join(directory,'work.db');
  const model=pathToFileURL(fileURLToPath(new URL('../../models/ConversationWorkModel.js',import.meta.url))).href;
  await writeFile(script,`import sqlite3 from ${JSON.stringify(pathToFileURL(require.resolve('sqlite3')).href)};
import {ConversationWorkModel} from ${JSON.stringify(model)};
const database=new sqlite3.Database(process.argv[2]);const store=new ConversationWorkModel(database);await store.initialize();
if(process.argv[3]==='create'){
 const active=await store.create({conversationId:'active',ownerId:'owner',objective:'Finish',now:0});
 const paused=await store.create({conversationId:'paused',ownerId:'owner',objective:'Stop',now:0});
 await store.claim(active.id,'owner',{now:1,leaseMs:10});await store.pause(paused.id,'owner',2);
 console.log(JSON.stringify({active:active.id,paused:paused.id}));
}else{
 const active=await store.claim(process.argv[4],'owner',{now:12});
 const paused=await store.claim(process.argv[5],'owner',{now:12});
 console.log(JSON.stringify({generation:active.generation,paused}));
}
await new Promise((resolve,reject)=>database.close(error=>error?reject(error):resolve()));`);
  const created=await run(script,[database,'create']);
  const recovered=await run(script,[database,'recover',created.active,created.paused]);
  expect(recovered).toEqual({generation:2,paused:null});
 }finally{await rm(directory,{recursive:true,force:true});}
},45000);
