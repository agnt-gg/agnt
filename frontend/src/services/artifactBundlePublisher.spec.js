import { describe, expect, it } from 'vitest';
import { dirtyOverrides, publishArtifactBundle } from './artifactBundlePublisher.js';

describe('artifactBundlePublisher', () => {
  it('maps dirty tabs relative to the artifact root', () => {
    expect(dirtyOverrides([{path:'site/index.html',content:'new',isDirty:true},{path:'other/x',content:'x',isDirty:true}], 'site')).toEqual([{path:'index.html',content:'new'}]);
  });
  it('uploads every file then finalizes', async () => {
    const calls=[];
    const response=(body={},headers={})=>({ok:true,status:200,json:async()=>body,arrayBuffer:async()=>new Uint8Array([1]).buffer,headers:new Headers(headers)});
    const fetchImpl=async (url,options={})=>{calls.push([url,options]);if(String(url).includes('publish-file'))return response();if(!options.method||options.method==='POST'&&!String(url).endsWith('finalize'))return response({id:'abc'});return response({id:'abc',status:'published'});};
    const manifest={rootPath:'site',entryPath:'index.html',totals:{files:2,bytes:2},files:[{path:'index.html',size:1,modifiedMs:2,mime:'text/html',sha256:'a'.repeat(64)},{path:'a.png',size:1,modifiedMs:2,mime:'image/png',sha256:'b'.repeat(64)}]};
    const result=await publishArtifactBundle({title:'x',manifest,token:'t',fetchImpl});
    expect(result.status).toBe('published');
    expect(calls.filter(([,o])=>o.method==='PUT')).toHaveLength(2);
    expect(calls.at(-1)[0]).toMatch(/finalize$/);
  });
  it('retries a transient upload and hashes editor overrides', async () => {
    let puts=0; let initManifest;
    const response=(body={},status=200)=>({ok:status<400,status,json:async()=>body,arrayBuffer:async()=>new ArrayBuffer(0),headers:new Headers()});
    const fetchImpl=async (url,options={})=>{
      if(options.method==='POST'&&!String(url).endsWith('finalize')){initManifest=JSON.parse(options.body).manifest;return response({id:'retry'});}
      if(options.method==='PUT'){puts++;return puts===1?response({error:'temporary'},503):response();}
      return response({id:'retry',status:'published'});
    };
    const manifest={rootPath:'site',entryPath:'index.html',totals:{files:1,bytes:3},files:[{path:'index.html',size:3,modifiedMs:1,mime:'text/html',sha256:'a'.repeat(64)}]};
    await publishArtifactBundle({title:'x',manifest,token:'t',overrides:[{path:'index.html',content:'new'}],fetchImpl});
    expect(puts).toBe(2);
    expect(initManifest.files[0].sha256).not.toBe('a'.repeat(64));
  });
});
