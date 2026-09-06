import {frontendRoot,evidence,output} from './paths.mjs';
import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';const require=createRequire(import.meta.url);const puppeteer=require('puppeteer');const root=frontendRoot;const {fixtureServer}=await import('./fixture-server.mjs');const server=await fixtureServer();
const port=server.httpServer.address().port;const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run','--js-flags=--max-old-space-size=512'],defaultViewport:{width:390,height:844,deviceScaleFactor:1,isMobile:true,hasTouch:true}});const results=[];const names=['Agents','Artifacts','WorkflowForge','Workspace','WidgetForge','ToolForge'];try{for(const name of names){const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text().slice(0,300));});await page.setRequestInterception(true);page.on('request',r=>{const u=r.url();if(u.startsWith('data:')||u.startsWith('blob:')||u.startsWith('http://127.0.0.1:'+port))r.continue();else if(u.includes('pdf.min.js'))r.respond({status:200,contentType:'application/javascript',body:'window.pdfjsLib={GlobalWorkerOptions:{}};'});else r.respond({status:200,contentType:'text/css',body:''});});try{await page.goto(`http://127.0.0.1:${port}/_harness/mobile-all.html?screen=${name}Screen`,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForFunction(()=>!!window.MOBILE_FIXTURE?.getScreen(),{timeout:45000});await new Promise(r=>setTimeout(r,1000));
const checks=[];async function check(name,fn){try{checks.push({name,pass:!!(await fn())});}catch(e){checks.push({name,pass:false,error:e.message});}}
if(name==='Agents'){
 await page.waitForSelector('[data-mobile-view="agents"] .m-record-open');await page.click('[data-mobile-view="agents"] .m-record-open');await new Promise(r=>setTimeout(r,250));
 await check('Selected agent detail visible',()=>page.$eval('.agent-details-section',e=>e.getBoundingClientRect().left>=0&&e.getBoundingClientRect().right<=innerWidth&&getComputedStyle(e).position==='absolute'));
 await page.evaluate(()=>[...document.querySelectorAll('.agent-details-section .tab-button')].find(b=>b.innerText.includes('Configure')).click());await new Promise(r=>setTimeout(r,200));
 await check('Actual configuration retains instructions and access fields',()=>page.$eval('.agent-details-section',e=>e.innerText.includes('System Prompt')&&e.innerText.includes('Tool Access')));
}
if(name==='Artifacts'){
 await page.waitForSelector('.m-file');await page.click('.m-file');await page.waitForFunction(()=>MOBILE_FIXTURE.getScreen().activeTab?.name==='briefing.md');
 await page.evaluate(()=>[...document.querySelectorAll('.ce-mobile-modes button')].find(b=>b.innerText==='Source').click());
 await check('Files source is full width',()=>page.$eval('.ce-editor-half',e=>{const r=e.getBoundingClientRect();return r.width>innerWidth-50&&r.width<=innerWidth;}));
 await page.evaluate(()=>[...document.querySelectorAll('.ce-mobile-modes button')].find(b=>b.innerText==='Preview').click());
 await check('File draft survives Source / Preview switching',async()=>{
   await page.evaluate(()=>[...document.querySelectorAll('.ce-mobile-modes button')].find(b=>b.innerText==='Source').click());await page.waitForSelector('.cm-content');await page.click('.cm-content');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.type('# Edited locally\nSource draft kept.');await page.evaluate(()=>[...document.querySelectorAll('.ce-mobile-modes button')].find(b=>b.innerText==='Preview').click());await page.evaluate(()=>[...document.querySelectorAll('.ce-mobile-modes button')].find(b=>b.innerText==='Source').click());return page.$eval('.cm-content',e=>e.innerText.includes('Edited locally'));
 });
 await check('Save uses actual file service',async()=>{const before=await page.evaluate(()=>MOBILE_FIXTURE.requests.length);await page.evaluate(()=>[...document.querySelectorAll('.ce-mobile-modes button')].find(b=>b.innerText==='Save').click());await new Promise(r=>setTimeout(r,150));return page.evaluate(before=>MOBILE_FIXTURE.requests.slice(before).some(r=>r.path.includes('/filesystem/file')&&r.method!=='GET'),before);});
 await page.evaluate(()=>[...document.querySelectorAll('.ce-mobile-modes button')].find(b=>b.innerText==='Preview').click());
 await check('Files preview full width',()=>page.$eval('.ce-preview-half',e=>e.getBoundingClientRect().width>innerWidth-50));
}
if(name==='WorkflowForge'){
 await page.evaluate(()=>[...document.querySelectorAll('.compact-workflow-controls button')].find(b=>b.innerText==='Add node').click());
 await page.click('#sidebar .node[data-type="web-search"]');await new Promise(r=>setTimeout(r,400));
 await check('Tap adds real schema node',()=>page.evaluate(()=>MOBILE_FIXTURE.getScreen().workflowDesigner.nodes.some(n=>n.type==='web-search')));
 await check('Node inspector opens',()=>page.$eval('.right-panel-component',e=>e.classList.contains('mobile-panel-visible')));
 await page.evaluate(()=>document.querySelector('.right-panel-component .mobile-close-button').click());
 const gesture=await page.evaluate(()=>{const canvas=MOBILE_FIXTURE.getScreen().workflowDesigner.$refs.canvas;const before=canvas.canvasOffsetX;const host=canvas.$el;const e={pointerType:'touch',pointerId:21,target:host,currentTarget:{setPointerCapture(){},releasePointerCapture(){}},clientX:20,clientY:20,preventDefault(){}};canvas.onTouchStart(e);canvas.onTouchMove({...e,clientX:70,clientY:50});canvas.onTouchEnd(e);return canvas.canvasOffsetX===before+50;});await check('Touch pan updates canvas',()=>gesture);
 await check('Connect actual nodes and inspect resulting edge',async()=>{
   await page.evaluate(()=>{const designer=MOBILE_FIXTURE.getScreen().workflowDesigner;if(designer.nodes.length<2)designer.addMobileNode({type:'web-search',title:'Web Search',category:'action',icon:'search',parameters:{query:{type:'string'}},outputs:{result:{type:'string'}}});});
   await new Promise(r=>setTimeout(r,160));await page.evaluate(()=>{document.querySelector('.right-panel-component .mobile-close-button')?.click();const designer=MOBILE_FIXTURE.getScreen().workflowDesigner;designer.mobileFrom=designer.nodes[0].id;designer.mobileTo=designer.nodes[1].id;designer.mobileConnections=true;});
   await new Promise(r=>setTimeout(r,100));await page.click('.compact-connection-form > button');await new Promise(r=>setTimeout(r,150));
   const result=await page.evaluate(()=>{const d=MOBILE_FIXTURE.getScreen().workflowDesigner;const edge=d.edges.at(-1);d.selectEdge(edge.id);return{edge:edge.start.id===d.nodes[0].id&&edge.end.id===d.nodes[1].id};});await new Promise(r=>setTimeout(r,100));return result.edge&&await page.$eval('.right-panel-component',e=>e.classList.contains('mobile-panel-visible'));
 });
 await page.evaluate(()=>document.querySelector('.right-panel-component .mobile-close-button')?.click());
 await check('Touch tap selects a real graph node',async()=>{await page.evaluate(()=>MOBILE_FIXTURE.getScreen().workflowDesigner.$refs.canvas.fitMobileGraph());await new Promise(r=>setTimeout(r,150));const pos=await page.$eval('#canvas .node',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};});await page.touchscreen.tap(pos.x,pos.y);await new Promise(r=>setTimeout(r,120));return page.$eval('.right-panel-component',e=>e.classList.contains('mobile-panel-visible'));});
}
if(name==='Workspace'){
 await page.waitForSelector('.compact-widget');const before=await page.evaluate(()=>JSON.stringify(MOBILE_FIXTURE.getScreen().active.widgets));
 await page.click('[aria-label="Expand widget"]');await page.click('[aria-label="Restore widget size"]');
 await check('Widget expand does not mutate desktop geometry',()=>page.evaluate(before=>JSON.stringify(MOBILE_FIXTURE.getScreen().active.widgets)===before,before));
 await check('Workspace composer is fully visible',()=>page.$eval('.wsc-root .chat-input-container',e=>{const r=e.getBoundingClientRect();return r.bottom<=visualViewport.height&&r.top>=0;}));
 await check('Workspace has conversation and composer',()=>page.evaluate(()=>!!document.querySelector('.wsc-root .message-wrapper')&&!!document.querySelector('.wsc-root textarea')));
}
if(name==='WidgetForge'){
 await page.click('[data-mobile-panel="right"]');await page.waitForSelector('.widget-forge-right-panel .config-form');
 await check('Widget config usable',()=>page.$eval('.config-form',e=>e.innerText.toLowerCase().includes('widget type')&&e.getBoundingClientRect().width<=innerWidth));
}
if(name==='ToolForge')await check('All real tool modes retained',()=>page.evaluate(()=>document.body.innerText.includes('AI')&&document.body.innerText.includes('JS')&&document.body.innerText.includes('PY')));
console.log('JOURNEY',name,JSON.stringify(checks));
const snapshot=await page.evaluate(()=>{const main=document.querySelector('.cv-dashboard');const bounds=main?.getBoundingClientRect();const bad=[...main.querySelectorAll('input,select,button,textarea')].filter(e=>e.getClientRects().length&&!e.closest('[inert]')).map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent.trim().slice(0,45)||e.getAttribute('aria-label')||e.getAttribute('placeholder'),left:r.left,right:r.right,top:r.top,width:r.width,height:r.height};}).filter(r=>r.left< -2||r.right>innerWidth+2);return {width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,body:document.body.innerText.slice(0,1800),bounds:bounds?.toJSON(),bad:bad.slice(0,12)};});results.push({name,...snapshot,errors,checks});await page.screenshot({path:output('full-'+name+'.png')});}catch(e){results.push({name,error:e.message,errors});}finally{await page.close();}console.log(name,JSON.stringify(results.at(-1)));}fs.writeFileSync(output('bundled-journeys-release.json'),JSON.stringify(results,null,2));if(results.some(r=>r.error||r.errors?.length||r.checks?.some(c=>!c.pass)))process.exitCode=1;}finally{await browser.close();await server.close();}
