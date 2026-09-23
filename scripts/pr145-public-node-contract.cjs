#!/usr/bin/env node
// Public CLI/TAP contract only. No internal Node parser API or binary stdout.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: false });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pr145-public-'));
const ids = ['plain-positive', 'unicode-positive', 'async-positive', 'teardown-positive'];
const unicode = 'ordinary Unicode café Ελληνικά 日本語 🧪';
const source = `const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const timer=setInterval(()=>{},1000);
after(()=>{clearInterval(timer);fs.writeFileSync(${JSON.stringify(path.join(scratch,'closed'))},'closed');console.log('TEARDOWN_COMPLETE');});
test('${ids[0]}',()=>assert.equal(2+2,4));
test('${ids[1]}',()=>{console.log(${JSON.stringify(unicode)});assert.ok(true);});
test('${ids[2]}',async()=>{await new Promise(r=>setTimeout(r,5));assert.ok(true);});
test('${ids[3]}',()=>assert.ok(timer));
`;
function save(name, bytes) { fs.writeFileSync(path.join(out,name),bytes,{flag:'wx',mode:0o444}); }
let result = {version:process.version, ids, skips:0, runs:[], teardown:false};
try {
  for(const negative of [false,true]) {
    const name=negative?'assertion-negative':'four-positive';
    const file=path.join(scratch,name+'.cjs');
    fs.writeFileSync(file,source+(negative?"test('deliberate-assertion',()=>assert.equal(1,2,'DELIBERATE_ASSERTION'));\n":''));
    const r=spawnSync(process.execPath,['--test','--test-reporter=tap',file],{env:{PATH:'/usr/bin:/bin',HOME:scratch,TMPDIR:scratch,LANG:'C.UTF-8'},stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:15000,maxBuffer:8*1024*1024});
    save(name+'.stdout',r.stdout||'');save(name+'.stderr',r.stderr||'');
    const receipt={name,status:r.status,signal:r.signal,error:r.error?{code:r.error.code,message:r.error.message}:null};
    result.runs.push(receipt);save(name+'.json',JSON.stringify(receipt,null,2));
    assert.equal(r.error,undefined,'timeout/spawn error is never a pass');assert.equal(r.signal,null);
    assert.equal(r.status,negative?1:0);
    for(const id of ids)assert.match(r.stdout,new RegExp('(?:^|\\n)ok \\d+ - '+id+'(?:\\n|\\r)'));
    assert.match(r.stdout,new RegExp(unicode));assert.match(r.stdout,/TEARDOWN_COMPLETE/);
    assert.match(r.stdout,new RegExp('# tests '+(negative?5:4)+'(?:\\n|\\r)'));
    assert.match(r.stdout,/# pass 4(?:\n|\r)/);assert.match(r.stdout,new RegExp('# fail '+(negative?1:0)+'(?:\\n|\\r)'));
    assert.match(r.stdout,/# skipped 0(?:\n|\r)/);assert.match(r.stdout,/# cancelled 0(?:\n|\r)/);
    assert.match(r.stdout,/# todo 0(?:\n|\r)/);
    if(negative){assert.match(r.stdout,/not ok \d+ - deliberate-assertion/);assert.match(r.stdout,/DELIBERATE_ASSERTION/);}
    assert.equal(fs.readFileSync(path.join(scratch,'closed'),'utf8'),'closed');
    fs.unlinkSync(path.join(scratch,'closed'));
  }
} finally {
  fs.rmSync(scratch,{recursive:true,force:true});result.teardown=!fs.existsSync(scratch);
  save('contract.json',JSON.stringify(result,null,2));
}
assert.equal(result.teardown,true);
console.log(JSON.stringify(result));
