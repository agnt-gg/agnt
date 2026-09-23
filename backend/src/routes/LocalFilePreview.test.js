import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import jwt from 'jsonwebtoken';
import LocalFileRoutes, * as routes from './LocalFileRoutes.js';
import { previewDocumentBase } from '../utils/artifactPreviewDocument.js';

let server, base, root, previousSecret;
const secret = 'isolated-preview-test';
const auth = () => ({ Authorization: `Bearer ${jwt.sign({id:'preview-test'}, secret)}` });
const url = (name, preview = true) => `${base}/api/${preview?'local-preview':'local-file'}/${encodeURI(path.join(root,name).replaceAll('\\','/'))}`;
let wrapper;
beforeAll(async () => {
  previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;
  root = await fs.mkdtemp(path.join(os.tmpdir(),'agnt-preview-'));
  wrapper = `<!doctype html><html><head><style>@font-face{font-family:Demo;src:url('${pathToFileURL(path.join(root,'font.woff2'))}')}</style></head><body><iframe src="${pathToFileURL(path.join(root,'child.html'))}#second"></iframe><script>const untouched="file:///example/in/code";</script></body></html>`;
  await fs.writeFile(path.join(root,'wrapper.html'),wrapper);
  await fs.writeFile(path.join(root,'child.html'),'<h1>Child</h1>');
  await fs.writeFile(path.join(root,'styles.css'),`@import '${pathToFileURL(path.join(root,'base.css'))}';body{background:url('${pathToFileURL(path.join(root,'a b.svg'))}#x')}`);
  await fs.writeFile(path.join(root,'.env'),'secret-fixture');
  const app=express();
  app.use('/api/local-file',LocalFileRoutes);
  if(routes.LocalPreviewRoutes)app.use('/api/local-preview',routes.LocalPreviewRoutes);
  server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});if(previousSecret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previousSecret;});

describe('saved artifact preview representation',()=>{
  it('uses the original browser URL rather than Express-normalized mount paths',async()=>{
    const source=await fs.readFile(new URL('./LocalFileRoutes.js',import.meta.url),'utf8');
    expect(source).toContain('previewDocumentBase(req.originalUrl, documentURL)');
    const router=express.Router();
    router.get(/.*/,(req,res)=>res.json({
      original:req.originalUrl, normalized:req.baseUrl+req.path,
      needsBase:previewDocumentBase(req.originalUrl,'/api/local-preview//tmp/example/wrapper.html')!==undefined,
    }));
    const app=express();app.use('/api/local-preview',router);
    const instance=await new Promise(resolve=>{const running=app.listen(0,'127.0.0.1',()=>resolve(running));});
    try {
      const response=await fetch(`http://127.0.0.1:${instance.address().port}/api/local-preview//tmp/example/wrapper.html?x=1`);
      expect(await response.json()).toEqual({original:'/api/local-preview//tmp/example/wrapper.html?x=1',normalized:'/api/local-preview/tmp/example/wrapper.html',needsBase:false});
    } finally { await new Promise(resolve=>instance.close(resolve)); }
  });
  it('rewrites the nested iframe and font without changing the source or script',async()=>{
    const response=await fetch(url('wrapper.html'),{headers:auth()});
    expect(response.status).toBe(200);
    const rendered=await response.text();
    expect(rendered).toContain('/api/local-preview/');
    expect(rendered).not.toMatch(/(?:src=|url\()['"]?file:/);
    expect(rendered).toContain('child.html#second');
    expect(rendered).toContain('const untouched="file:///example/in/code";');
    expect(rendered).not.toContain('<base href=');
    expect(response.headers.get('content-length')).toBe(String(Buffer.byteLength(rendered)));
    expect(await fs.readFile(path.join(root,'wrapper.html'),'utf8')).toBe(wrapper);
  });
  it('keeps canonical path previews unchanged when a diagnostic query is present',async()=>{
    const response=await fetch(url('wrapper.html')+'?__agnt_preview=0123456789abcdef',{headers:auth()});
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('<base href=');
  });
  it('provides the file base for query-form previews and resolves relative children',async()=>{
    const response=await fetch(`${base}/api/local-preview?path=${encodeURIComponent(path.join(root,'wrapper.html'))}`,{headers:auth()});
    expect(response.status).toBe(200);
    const rendered=await response.text();
    const baseHref=rendered.match(/<base href="([^"]+)"/)[1];
    const child=await fetch(new URL('child.html',new URL(baseHref,base)),{headers:auth()});
    expect(child.status).toBe(200);
    expect(await child.text()).toContain('<h1>Child</h1>');
    expect(await fs.readFile(path.join(root,'wrapper.html'),'utf8')).toBe(wrapper);
  });
  it('preserves raw downloads byte for byte',async()=>{
    const response=await fetch(url('wrapper.html',false),{headers:auth()});
    expect(await response.text()).toBe(wrapper);
  });
  it('rewrites external CSS and keeps fragments and spaces',async()=>{
    const response=await fetch(url('styles.css'),{headers:auth()});
    expect(response.status).toBe(200);
    const css=await response.text();
    expect(css).not.toContain('file:///');
    expect(css).toContain('a%20b.svg#x');
    expect(css).toContain('base.css');
  });
  it('requires auth on preview subresources',async()=>{
    expect((await fetch(url('child.html'))).status).toBe(401);
  });
  it('retains credential-file refusal',async()=>{
    expect((await fetch(url('.env'),{headers:auth()})).status).toBe(403);
  });
  it('retains missing-file status',async()=>{
    expect((await fetch(url('missing.html'),{headers:auth()})).status).toBe(404);
  });
  it('does not return source-byte ranges for transformed HTML',async()=>{
    const response=await fetch(url('wrapper.html'),{headers:{...auth(),Range:'bytes=0-4'}});
    expect(response.status).toBe(200);
    expect(response.headers.get('accept-ranges')).toBe('none');
    expect(await response.text()).toContain('<!doctype html>');
  });
});
