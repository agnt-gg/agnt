import { describe, expect, it } from 'vitest';
import { prepareArtifactBundle, publishArtifactBundle } from './artifactBundlePublisher.js';
const response = (body = {}, bytes = new Uint8Array()) => ({ok:true,status:200,json:async()=>body,arrayBuffer:async()=>bytes.buffer,headers:new Headers()});
const prepared = (hash = 'new') => ({schemaVersion:1,preparationId:'local-snapshot',preparationSource:{entryPath:'site/index.html',includeDirs:['site/private-data']},rootPath:'site',imported:[{sourcePath:'C:/private/image.png'}],entryPath:'index.html',manifestHash:hash,totals:{files:1,bytes:3},files:[{path:'index.html',size:3,sha256:'a'.repeat(64),mime:'text/html'}],
  sources:{'index.html':{kind:'entry',reason:'the entry'}}, warnings:[{kind:'runtime_load',file:'index.html',detail:'fetch(url)',folder:'site/private-data'}], includeDirs:['site/private-data']});

describe('portable upload snapshot', () => {
  it('normalizes overrides before initialization and sends only prepared bytes, never local metadata', async () => {
    const calls=[]; const bytes=new Uint8Array([1,2,3]);
    const fetchImpl=async(url,options={})=>{
      calls.push({url:String(url),options});
      if(String(url).endsWith('/publish-manifest')) return response(prepared());
      if(String(url).includes('/publish-file?')) return response({},bytes);
      if(options.method==='POST'&&!String(url).endsWith('/finalize')) return response({id:'remote'});
      return response({status:'published'});
    };
    await publishArtifactBundle({title:'design',token:'token',manifest:prepared(),overrides:[{path:'index.html',content:'<img src="file:///C:/private/image.png">'}],fetchImpl});
    expect(calls[0].url).toContain('/publish-manifest');
    expect(JSON.parse(calls[0].options.body).overrides[0].content).toContain('file:///');
    const init=calls.find(c=>c.url==='https://agnt.gg/api/creation-bundles');
    expect(init.options.body).not.toContain('C:/private');
    expect(init.options.body).not.toContain('preparationId');
    expect(init.options.body).not.toContain('preparationSource');
    // why-lists and warnings name local folders; they never leave the machine
    for (const local of ['private-data', 'sources', 'warnings', 'includeDirs']) expect(init.options.body).not.toContain(local);
    // publish-time re-preparation reproduces the same opted-in folders
    expect(JSON.parse(calls[0].options.body).includeDirs).toEqual(['site/private-data']);
    expect(calls.find(c=>c.url.includes('/publish-file?')).url).toContain('preparationId=local-snapshot');
    expect(new Uint8Array(calls.find(c=>c.options.method==='PUT').options.body)).toEqual(bytes);
  });
  it('sends opted-in folders with a preparation, and none unless asked', async () => {
    const bodies=[];
    const fetchImpl=async(url,options={})=>{ bodies.push(JSON.parse(options.body)); return response(prepared()); };
    const realFetch=globalThis.fetch; globalThis.fetch=fetchImpl;
    try {
      await prepareArtifactBundle('site/index.html','t');
      await prepareArtifactBundle('site/index.html','t','site',['site/frames']);
      await prepareArtifactBundle({html:'<p>x</p>',baseDir:'site'},'t',undefined,['site/data']);
    } finally { globalThis.fetch=realFetch; }
    expect(bodies[0]).toEqual({entryPath:'site/index.html'});
    expect(bodies[1]).toEqual({entryPath:'site/index.html',rootPath:'site',includeDirs:['site/frames']});
    expect(bodies[2]).toEqual({html:'<p>x</p>',baseDir:'site',includeDirs:['site/data']});
  });
  it('starts a new remote bundle when a previous upload contains stale hashes', async () => {
    const calls=[];
    const fetchImpl=async(url,options={})=>{
      calls.push({url:String(url),options});
      if(String(url).endsWith('/old')&&!options.method) return response({id:'old',status:'staging',manifest:{manifestHash:'old'},uploaded:['index.html']});
      if(options.method==='POST'&&!String(url).endsWith('/finalize'))return response({id:'fresh'});
      return response({status:'published'});
    };
    await publishArtifactBundle({title:'x',manifest:prepared(),bundleId:'old',fetchImpl});
    expect(calls.some(c=>c.options.method==='PUT'&&c.url.includes('/fresh/files/'))).toBe(true);
    expect(calls.some(c=>c.url.includes('/old/finalize'))).toBe(false);
  });
});
