import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {selectFiles,matchesSelector} from '../../../scripts/run-node-tests.mjs';
const root=fileURLToPath(new URL('../../../',import.meta.url));
test('Given recursive native selectors Then root-level and nested tests match without CLI glob support',()=>{
 assert.equal(matchesSelector('tests/unit/storage/example.test.js','tests/unit/storage/**/*.test.js'),true);
 assert.equal(matchesSelector('tests/unit/storage/nested/example.test.js','tests/unit/storage/**/*.test.js'),true);
 assert.equal(matchesSelector('tests/unit/providersXtestXjs','tests/unit/providers.test.js'),false);
});
test('Given all unit files Then every native test and no Vitest file is selected',()=>{
 const selected=new Set(selectFiles(root));
 const visit=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())visit(p);else if(e.name.endsWith('.test.js')){const s=fs.readFileSync(p,'utf8'),r=path.relative(root,p).split(path.sep).join('/');const native=/from\s+['"]node:test['"]|require\(\s*['"]node:test['"]/.test(s),vitest=/from\s+['"]vitest['"]|require\(\s*['"]vitest['"]/.test(s);if(native)assert.ok(selected.has(r),r);if(vitest)assert.ok(!selected.has(r),r);}}};
 visit(path.join(root,'tests/unit'));assert.ok(selected.size>20);
});
