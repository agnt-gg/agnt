import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../../backend/src/models/database/index.js',import.meta.url),'utf8');
const start=source.indexOf('let dbDir = pathManager.getDataDir();');
const end=source.indexOf('// CRITICAL: PRAGMAs');
const preopen=source.slice(start,end);
function run({kind,failProbe=false}={}){
 const calls=[];let callback;
 const mock={...fs,lstatSync:p=>{calls.push(['lstat',p]);if(p==='/fixture/Data')return{isDirectory:()=>true};if(p.endsWith(kind?.suffix||'/never'))return{isFile:()=>kind.regular,nlink:kind.links};throw Object.assign(Error('absent'),{code:'ENOENT'});},realpathSync:p=>p,openSync:(p,flags)=>{calls.push(['open',p,flags]);if(failProbe)throw Error('synthetic write refusal');return 10;},closeSync:()=>{},writeFileSync:(p)=>{calls.push(['write',p]);if(failProbe)throw Error('synthetic write refusal');},unlinkSync:p=>calls.push(['unlink',p]),existsSync:()=>false,mkdirSync:p=>calls.push(['mkdir',p])};
 const ctx={crypto:{randomUUID:()=>'fixture-id'},fs:mock,path,os:{tmpdir:()=>'/fixture'},pathManager:{getDataDir:()=>'/fixture/Data'},detectStorageMode:()=> 'test',migrateLegacyDatabase:()=>calls.push(['legacy']),process:{env:{HOME:'/forbidden'},platform:'linux',pid:123},console:{log(){},error(){}},sqlite3:{Database:function(p,cb){calls.push(['sqlite',p]);callback=cb;}}};
 let error;try{vm.runInNewContext(preopen,ctx);}catch(e){error=e;}
 return{calls,error};
}
for(const suffix of ['/agnt.db','-wal','-shm','-journal'])for(const kind of [{regular:false,links:1},{regular:true,links:2}])test('Reject '+suffix+' '+JSON.stringify(kind)+' BEFORE SQLite opens',()=>{const r=run({kind:{suffix,...kind}});assert.ok(r.error);assert.equal(r.calls.some(c=>c[0]==='sqlite'),false);});
test('Probe refusal cannot choose HOME fallback or legacy migration',()=>{const r=run({failProbe:true});assert.ok(r.error);assert.equal(r.calls.some(c=>['sqlite','mkdir','legacy'].includes(c[0])),false);});
test('Allowed missing DB reaches SQLite and uses exclusive unique probe',()=>{const r=run();assert.equal(r.error,undefined);assert.equal(r.calls.filter(c=>c[0]==='sqlite').length,1);assert.ok(r.calls.some(c=>c[0]==='open'&&c[2]==='wx'));assert.equal(r.calls.some(c=>c[1]?.endsWith('/.test')),false);});
