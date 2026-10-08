import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
// Backend lifecycle, OS identity/keychain and explicit account/device setup are
// trusted administration, not generated tool code. Any NEW raw process path
// must be reviewed here instead of quietly bypassing toolProcess.
const trusted=new Set([
 // Protected by pluginAccountBoundary's hosted owner-only mutation gate.
 'routes/PluginRoutes.js','plugins/PluginInstaller.js',
 'services/NetworkIdentity.js','services/TailscaleServe.js',
 'services/auth/CursorCliAuthManager.js','services/auth/GrokBuildAuthManager.js','services/auth/secretStore.js',
 'services/localModelRuntime.js','services/localModels/hardware.js','services/localModels/managedRuntime.js',
 'services/security/toolProcess.js','utils/chrome-detector.js','workflow/WorkflowProcessBridge.js'
]);
function* sources(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='__fixtures__'||e.name==='node_modules')continue;const p=path.join(dir,e.name);if(e.isDirectory())yield* sources(p);else if(/\.(js|mjs)$/.test(e.name)&&!e.name.includes('.test.'))yield p;}}
describe('process boundary coverage',()=>{
 it('generated-code and tool process creation has no raw child_process path',()=>{
  const bypasses=[];
  for(const p of sources(root)){const relative=path.relative(root,p).replaceAll('\\','/');const text=fs.readFileSync(p,'utf8');if(/(?:from\s*|import\s*\(|require\s*\()\s*['"](?:node:)?child_process['"]/.test(text)&&!trusted.has(relative))bypasses.push(relative);}
  expect(bypasses).toEqual([]);
 });
});
