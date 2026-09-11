import fs from 'node:fs';import path from 'node:path';
import {listFiles} from '../../scripts/bundle/inventory.mjs';
// Metadata only. No chunks, dependencies, warning thresholds or runtime altered.
export function bundleMeasurement(){let config;return {name:'agnt-bundle-measurement',apply:'build',configResolved(c){config=c},writeBundle:{order:'post',handler(_options,bundle){
 const graph={};for(const n of Object.values(bundle))if(n.type==='chunk')graph[n.fileName]={file:n.fileName,imports:n.imports,dynamicImports:n.dynamicImports,isEntry:n.isEntry,sourceId:n.facadeModuleId?path.relative(config.root,n.facadeModuleId).split(path.sep).join('/'):`chunk:${n.name}`,css:[...(n.viteMetadata?.importedCss||[])],assets:[...(n.viteMetadata?.importedAssets||[])],modules:Object.entries(n.modules).map(([id,m])=>({id:path.relative(config.root,id).split(path.sep).join('/'),renderedLength:m.renderedLength})).sort((a,b)=>b.renderedLength-a.renderedLength)};
 const publicFiles=[...listFiles(config.publicDir||path.join(config.root,'public')),...listFiles(path.join(config.root,'src/assets/icons')).map(p=>'assets/icons/'+p)];
 fs.writeFileSync(path.resolve(config.root,config.build.outDir,'.bundle-graph.json'),JSON.stringify({schemaVersion:1,graph,emitted:Object.keys(bundle).sort(),publicFiles:[...new Set(publicFiles)].sort()},null,2));
 }}};}
