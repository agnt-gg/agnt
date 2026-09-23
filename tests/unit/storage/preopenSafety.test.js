// LIMITS NOTE (PR145 A1, planner P11 — updated for the D4/D5 pipeline):
// This vm harness string-extracts the pre-open pipeline from
// backend/src/models/database/index.js and runs it against MOCKED fs/sqlite3
// (realpath is identity, the sqlite constructor is a stub, the storage
// context is a fixture). It therefore proves ORDERING — the context gate,
// dbDir containment, post-probe identity revalidation and sidecar alias
// refusals all happen BEFORE any constructor/PRAGMA effect — not native
// filesystem behavior, and NOT anything about the real SQLite handle: the
// write probe is a write-permission probe inside the admitted root; a second
// file descriptor is never evidence of which database sqlite3 opened
// (contract §1). Native-path negatives (real symlink/hardlink/FIFO on root,
// ancestors, db and sidecars) + native open/schema/write/readback/close, and
// the deterministic swap controller with a synchronized barrier, require
// NEW test files that are pending new-file consent
// (tests/unit/storage/preopenAliases.native.test.js, swapControl.test.js).
// Until they exist this file is PARTIAL R05/R06 evidence only — it does not
// close R05/R06/R07.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../../backend/src/models/database/index.js',import.meta.url),'utf8');
const start=source.indexOf('let dbDir = pathManager.getDataDir();');
const end=source.indexOf('// CRITICAL: PRAGMAs');
assert.ok(start>0&&end>start,'pipeline markers moved — update this extractor in lockstep');
const preopen=source.slice(start,end);

// Fixture storage context for the vm: getStorageContext() in the fragment is
// a free variable supplied here (the real one performs structural/ancestor
// validation against the real fs, which the mock cannot provide).
const FIXTURE_CTX_OK=()=>Object.freeze({root:'/fixture'});
const FIXTURE_CTX_THROW=()=>{throw new Error('synthetic context refusal');};
const FIXTURE_CTX_FOREIGN=()=>Object.freeze({root:'/other'});

function run({kind,failProbe=false,ctxFn=FIXTURE_CTX_OK,swapDbDirAfterProbe=false}={}){
 const calls=[];let callback;let dbDirLstats=0;
 const mock={...fs,
   lstatSync:p=>{
     calls.push(['lstat',p]);
     if(p==='/fixture/Data'){
       dbDirLstats++;
       // D5 swap variant: the SECOND lstat of dbDir (post-probe
       // revalidation) reports a different inode — a concurrent directory
       // swap at the validation/open seam.
       const ino=swapDbDirAfterProbe&&dbDirLstats>1?9999:22;
       return{isDirectory:()=>true,isSymbolicLink:()=>false,dev:11,ino};
     }
     if(p.endsWith(kind?.suffix||'/never'))return{isFile:()=>kind.regular,nlink:kind.links};
     throw Object.assign(Error('absent'),{code:'ENOENT'});},
   realpathSync:p=>p,
   openSync:(p,flags)=>{calls.push(['open',p,flags]);if(failProbe)throw Error('synthetic write refusal');return 10;},
   closeSync:()=>{},
   writeFileSync:(p)=>{calls.push(['write',p]);if(failProbe)throw Error('synthetic write refusal');},
   unlinkSync:p=>calls.push(['unlink',p]),
   existsSync:()=>false,
   mkdirSync:p=>calls.push(['mkdir',p])};
 const ctx={crypto:{randomUUID:()=>'fixture-id'},fs:mock,path,os:{tmpdir:()=>'/fixture'},pathManager:{getDataDir:()=>'/fixture/Data'},detectStorageMode:()=>'test',migrateLegacyDatabase:()=>calls.push(['legacy']),getStorageContext:ctxFn,process:{env:{HOME:'/forbidden'},platform:'linux',pid:123},console:{log(){},error(){}},sqlite3:{Database:function(p,cb){calls.push(['sqlite',p]);callback=cb;}}};
 let error;try{vm.runInNewContext(preopen,ctx);}catch(e){error=e;}
 return{calls,error};
}

// ── Kept matrix: every pre-existing db/sidecar alias refusal (R05 vm half) ──
for(const suffix of ['/agnt.db','-wal','-shm','-journal'])for(const kind of [{regular:false,links:1},{regular:true,links:2}])test('Reject '+suffix+' '+JSON.stringify(kind)+' BEFORE SQLite opens',()=>{const r=run({kind:{suffix,...kind}});assert.ok(r.error);assert.equal(r.calls.some(c=>c[0]==='sqlite'),false);});
test('Probe refusal cannot choose HOME fallback or legacy migration',()=>{const r=run({failProbe:true});assert.ok(r.error);assert.equal(r.calls.some(c=>['sqlite','mkdir','legacy'].includes(c[0])),false);});
test('Allowed missing DB reaches SQLite and uses exclusive unique probe',()=>{const r=run();assert.equal(r.error,undefined);assert.equal(r.calls.filter(c=>c[0]==='sqlite').length,1);assert.ok(r.calls.some(c=>c[0]==='open'&&c[2]==='wx'));assert.equal(r.calls.some(c=>c[1]?.endsWith('/.test')),false);});

// ── D4 additions: context gate + containment precede every fs effect ──────
test('Context-gate refusal precedes EVERY filesystem effect (D4/S1)',()=>{
 const r=run({ctxFn:FIXTURE_CTX_THROW});
 assert.ok(r.error);
 assert.match(String(r.error),/synthetic context refusal/);
 assert.equal(r.calls.length,0,'no lstat/probe/constructor may run before the context validates');
});
test('dbDir outside the admitted context root refuses before any probe (D4)',()=>{
 const r=run({ctxFn:FIXTURE_CTX_FOREIGN});
 assert.ok(r.error);
 assert.match(String(r.error),/not the admitted storage context data directory/);
 assert.equal(r.calls.some(c=>c[0]==='open'),false,'no write probe for an unadmitted path');
 assert.equal(r.calls.some(c=>c[0]==='sqlite'),false);
});

// ── D5 addition: post-probe identity revalidation (vm-level swap seam) ────
test('Post-probe dbDir identity swap refuses BEFORE the constructor (D5 seam)',()=>{
 // The probe legitimately ran (the directory was valid at validation time);
 // the swap lands between validation and open. Trusted mode REFUSES the
 // open — it does NOT claim the race is impossible (R06 split: the residual
 // is a swap racing THIS check and the constructor; the barrier-driven
 // native controller is the consent-pending swapControl file).
 const r=run({swapDbDirAfterProbe:true});
 assert.ok(r.error);
 assert.match(String(r.error),/identity changed between validation and open/);
 assert.ok(r.calls.some(c=>c[0]==='open'&&c[2]==='wx'),'probe DID run — ordering is validate→probe→revalidate→constructor');
 assert.equal(r.calls.some(c=>c[0]==='sqlite'),false,'constructor never ran for the swapped directory');
});
