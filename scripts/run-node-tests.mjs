// Expand native-test selection explicitly: Node 20 does not expand CLI globs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
export const selectors = ['tests/unit/async*.test.js','tests/unit/autonomous*.test.js','tests/unit/providers.test.js','tests/unit/storage/**/*.test.js'];
export function matchesSelector(file, selector) {
  const re = selector.split('**/').map(part => part.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('[^/]*')).join('(?:.*/)?');
  return new RegExp('^'+re+'$').test(file);
}
export function selectFiles(root) {
  const files=[];
  function walk(dir){for(const e of fs.readdirSync(path.join(root,dir),{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.isFile()&&selectors.some(s=>matchesSelector(p,s)))files.push(p);}}
  walk('tests/unit');return files.sort();
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const files=selectFiles(root);
  if(!files.length)throw Error('No native test files selected');
  if(process.argv.includes('--list'))console.log(JSON.stringify(files,null,2));
  else {
    const child=spawnSync(process.execPath,['--import', './tests/setup/node-test-setup.mjs','--test',...files],{cwd:root,stdio:'inherit'});
    if(child.error)throw child.error;
    if(child.signal)process.kill(process.pid,child.signal);
    else process.exitCode=child.status??1;
  }
}
