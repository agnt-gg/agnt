import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../../scripts/test-sandbox.mjs',import.meta.url),'utf8');
const match=source.match(/control\('fd-negative-inherited-socket-closed', ([^\n]+),\n/);
assert.ok(match,'actual inherited-socket predicate must be inspected');
const evaluate=(r,link='(no output)')=>vm.runInNewContext(match[1],{r,link,socketGone:!/^socket:/.test(link),noLeak:true});
test('Given launcher denial When no worker ran Then isolation is not verified',()=>{
 assert.equal(evaluate({exit:{code:1},innerExit:null,timedOut:false}),false);
});
test('Given closed inherited socket and successful worker Then control passes',()=>{
 assert.equal(evaluate({exit:{code:0},innerExit:{code:0,signal:null},timedOut:false},'anon_inode:[eventpoll]'),true);
});
test('Given surviving inherited socket Then successful exit is insufficient',()=>{
 assert.equal(evaluate({exit:{code:0},innerExit:{code:0,signal:null},timedOut:false},'socket:[123]'),false);
});
test('Given emitted marker but failing worker Then control refuses',()=>{
 assert.equal(evaluate({exit:{code:7},innerExit:{code:7,signal:null},timedOut:false},'anon_inode:[eventpoll]'),false);
});
const network=source.match(/const blocked = ([^\n]+);/);
assert.ok(network,'actual outside-listener predicate required');
const net=r=>vm.runInNewContext(network[1],{r});
test('Given a routing error rather than outside-listener refusal Then control fails',()=>{
 assert.equal(net({out:'NET=BLOCKED:ENETUNREACH',exit:{code:0},innerExit:{code:0,signal:null}}),false);
});
test('Given outside-listener ECONNREFUSED and successful worker Then negative control passes',()=>{
 assert.equal(net({out:'NET=BLOCKED:ECONNREFUSED',exit:{code:0},innerExit:{code:0,signal:null}}),true);
});
