#!/usr/bin/env node
// Real MessageItem + real auth/file router, on port 0. Never starts AGNT or opens its DB.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { chromium } from 'playwright';
import LocalFileRoutes, { LocalPreviewRoutes } from '../backend/src/routes/LocalFileRoutes.js';
import { MEDIA_COOKIE_NAME } from '../backend/src/utils/authGuard.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const frontend=path.join(repo,'frontend');
const requireFrontend=createRequire(path.join(frontend,'package.json'));
const vitePackage = path.dirname(requireFrontend.resolve('vite/package.json'));
const {createServer}=await import(pathToFileURL(path.join(vitePackage,'dist/node/index.js')).href);
const out=path.resolve(process.argv[2] || path.join(os.tmpdir(),`agnt-chat-render-${Date.now()}`));
await fs.mkdir(out,{recursive:true});
const fixture=await fs.mkdtemp(path.join(out,'fixtures-'));
const originalDir=process.argv[3] ? path.resolve(process.argv[3]) : null;
const mainFile=originalDir?path.join(originalDir,'AGNT-EXCHANGE.html'):path.join(fixture,'child.html');
const wrapperFile=originalDir?path.join(originalDir,'PREVIEW.html'):path.join(fixture,'wrapper.html');
await fs.writeFile(path.join(fixture,'child.html'),'<!doctype html><html><body><h1>Artifact loaded</h1><p id="second">Second page</p></body></html>');
await fs.writeFile(path.join(fixture,'wrapper.html'),`<!doctype html><html><body><h1>Wrapper</h1><iframe style="width:100%;height:700px" src="${pathToFileURL(mainFile)}"></iframe></body></html>`);
await fs.writeFile(path.join(fixture,'broken.html'),'<!doctype html><html><body><h1>Missing resource</h1><img src="missing.png"></body></html>');
await fs.writeFile(path.join(fixture,'restricted.html'),`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="script-src 'none'"></head><body><h1>Policy preserved</h1></body></html>`);
await fs.writeFile(path.join(fixture,'special #é.html'),'<h1>Encoded filename</h1>');
const originals=new Map();for(const file of [mainFile,wrapperFile])originals.set(file,await fs.readFile(file));
const previous={secret:process.env.JWT_SECRET,roots:process.env.AGNT_LOCAL_FILE_ROOTS};
process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
process.env.AGNT_LOCAL_FILE_ROOTS=[fixture,originalDir].filter(Boolean).join(path.delimiter);
let server,vite,browser;
const checks=[];
const assert=(condition,label,details={})=>{checks.push({label,passed:!!condition,...details});if(!condition)throw new Error(label);};
try{
  const moduleId='/__chat_artifact_check.js';
  const source=`import {createApp,h,reactive} from 'vue';import {createStore} from 'vuex';import MessageItem from ${JSON.stringify(path.join(frontend,'src/views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue').replaceAll('\\','/'))};const state=reactive({message:{id:'fixture',role:'assistant',content:'Ready',toolCalls:[]}});const store=createStore({state:{agents:{agents:[]},chat:{activeConversationId:null,conversations:{}},userAuth:{token:'isolated-test'},settings:{}}});const app=createApp({render:()=>h(MessageItem,{message:state.message,status:null,imageCache:new Map()})});app.use(store);app.component('Tooltip',{render:()=>null});app.mount('#app');let serial=0;window.showMessage=(message)=>{state.message={role:'assistant',id:'fixture-'+(++serial),...message};};window.fixtureReady=true;`;
  vite=await createServer({root:frontend,configFile:path.join(frontend,'vite.config.js'),server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'chat-artifact-check',resolveId(id){if(id===moduleId)return '\0chat-artifact-check';},load(id){if(id==='\0chat-artifact-check')return source;}}]});
  const app=express();
  app.use('/api/local-file',LocalFileRoutes);app.use('/api/local-preview',LocalPreviewRoutes);
  app.get('/api/filesystem/settings',(_req,res)=>res.json({workspaceRoot:originalDir||fixture}));
  app.get('/__chat_artifact_check',async(req,res,next)=>{try{res.type('html').send(await vite.transformIndexHtml(req.originalUrl,`<!doctype html><html><head><style>body{margin:0;padding:16px;background:#10101f;color:#f7f7f7;font-family:sans-serif;--color-text:#f7f7f7;--color-navy:#151525;--color-orange:#ffb35c;--color-duller-navy:#303044}#app{width:100%;max-width:1300px;margin:auto}</style></head><body><div id="app"></div><script type="module" src="${moduleId}"></script></body></html>`));}catch(error){next(error);}});
  app.use(vite.middlewares);
  server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:1200,height:1000}});
  await context.addCookies([{name:MEDIA_COOKIE_NAME,value:jwt.sign({id:'isolated-preview'},process.env.JWT_SECRET,{expiresIn:'10m'}),url:origin,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage();const errors=[];const requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)requests.push({url:response.url(),status:response.status()});});
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin)return route.abort();return route.continue();});
  const open=async message=>{await page.goto(origin+'/__chat_artifact_check',{waitUntil:'networkidle'});await page.waitForFunction(()=>window.fixtureReady);errors.length=0;requests.length=0;await page.evaluate(message=>window.showMessage(message),message);await page.locator('#app iframe').first().waitFor({state:'attached',timeout:15000});};
  const artifact=(file,view='')=>'```artifact\n'+JSON.stringify({path:file.replaceAll('\\','/'),title:'Artifact regression',view})+'\n```';
  for(const mode of ['artifact','matched','direct','inline']) {
    const wrapper=originals.get(wrapperFile).toString('utf8');
    const message=mode==='artifact'?{content:artifact(mainFile)}:mode==='matched'?{content:'```html\n'+wrapper+'\n```',toolCalls:[{name:'read_file',args:{path:wrapperFile},result:{absolutePath:wrapperFile,content:wrapper}}]}:mode==='direct'?{content:`<iframe title="Direct" src="${pathToFileURL(wrapperFile)}" width="100%" height="850"></iframe>`}:{content:'```html\n'+wrapper+'\n```'};
    await open(message);
    const target=async()=>page.frames().find(frame=>frame.url().includes(encodeURI(mainFile.replaceAll('\\','/'))));
    await page.waitForFunction(expected=>[...document.querySelectorAll('iframe')].some(f=>!!f.contentDocument),mainFile);
    let child;for(let attempt=0;attempt<150;attempt++){child=await target();if(child&&await child.locator('h1').count())break;await page.waitForTimeout(100);}
    assert(!!child,mode+' target frame loaded');
    const heading=originalDir?'#page-home h1':'h1';await child.locator(heading).waitFor({state:'visible'});
    await child.evaluate(()=>document.fonts.ready);
    assert((await child.locator(heading).innerText()).length>0,mode+' visible content');
    if(originalDir){for(const route of ['home','marketplace','service','connect','connections','usage','seller','publish']){await child.evaluate(route=>location.hash=route,route);await child.locator('#page-'+route+' h1').waitFor({state:'visible'});}assert(true,mode+' eight routes');}
    assert((await child.evaluate(()=>[...document.fonts].every(f=>f.status==='loaded'))),mode+' fonts loaded');
    if(mode!=='inline')await page.locator('.artifact-preview-status[data-state="loaded"]').waitFor({state:'attached',timeout:15000});
    assert(errors.length===0,mode+' no console errors',{errors:[...errors]});
    assert(requests.length===0,mode+' no failed HTTP resources',{requests:[...requests]});
    if(mode==='artifact'){
      assert(await child.locator('iframe').count()===0,'artifact reference has no wrapper iframe');
      await page.locator('.preview-btn').first().click();
      await page.locator('.html-preview-iframe').waitFor({state:'attached'});
      assert((await page.locator('.html-preview-iframe').getAttribute('src')).includes('/api/local-preview/'),'fullscreen uses prepared representation');
      await page.keyboard.press('Escape');
    }
    await page.screenshot({path:path.join(out,mode+'.png'),fullPage:true});
  }
  await open({content:artifact(path.join(fixture,'special #é.html'))});
  const encoded=page.frameLocator('#app iframe').first();await encoded.getByRole('heading',{name:'Encoded filename'}).waitFor();assert(true,'encoded path filename survives HTTP route');
  await open({content:artifact(path.join(fixture,'broken.html'))});
  await page.locator('.artifact-preview-status[data-state="warning"]').waitFor({state:'visible'});assert(true,'resource failures visible in chat');
  await open({content:artifact(path.join(fixture,'restricted.html'))});
  await page.locator('.artifact-preview-status[data-state="unconfirmed"]').waitFor({state:'visible',timeout:15000});assert(true,'CSP preserved with unconfirmed fallback');
  await open({content:artifact(path.join(fixture,'missing.html'))});
  await page.locator('.artifact-preview-status[data-state="unconfirmed"]').waitFor({state:'visible',timeout:15000});assert(true,'missing file is not silently marked loaded');
  for(const width of [390,320]){await page.setViewportSize({width,height:850});await open({content:artifact(mainFile)});await page.locator('.artifact-preview-status[data-state="loaded"]').waitFor({state:'attached'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`chat fits ${width}px`);}
  for(const [file,bytes]of originals)assert((await fs.readFile(file)).equals(bytes),'original artifact unchanged',{file});
  assert((await fetch(origin+'/api/local-preview/'+encodeURI(mainFile.replaceAll('\\','/')))).status===401,'preview endpoint rejects missing auth');
  console.log(JSON.stringify({passed:checks.length,checks},null,2));
}finally{
  await fs.writeFile(path.join(out,'browser-results.json'),JSON.stringify({checks},null,2));
  if(browser)await browser.close();if(vite)await vite.close();if(server)await new Promise(resolve=>server.close(resolve));
  if(previous.secret===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous.secret;
  if(previous.roots===undefined)delete process.env.AGNT_LOCAL_FILE_ROOTS;else process.env.AGNT_LOCAL_FILE_ROOTS=previous.roots;
}
