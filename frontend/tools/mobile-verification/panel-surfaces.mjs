import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fixtureServer } from './fixture-server.mjs';
import { output } from './paths.mjs';
const require=createRequire(import.meta.url),puppeteer=require('puppeteer');
const server=await fixtureServer(),origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run','--js-flags=--max-old-space-size=512'],defaultViewport:{width:390,height:844,isMobile:true,hasTouch:true}});
const screens=['Chat','Dashboard','Agents','AgentForge','Skills','Memory','Tools','ToolForge','WidgetManager','WidgetForge','Workflows','WorkflowForge','Traces','Artifacts','Connectors','Plugins','Marketplace','Settings','Autonomy','Experiments'];
const results=[],errors=[];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function measure(page,label,selector){
 const data=await page.$eval(selector,host=>{
   const h=host.getBoundingClientRect(),style=getComputedStyle(host);
   const body=host.querySelector(':scope > .panel-content-wrapper')||host;
   const b=body.getBoundingClientRect(),bs=getComputedStyle(body),gutter={left:parseFloat(bs.paddingLeft),right:parseFloat(bs.paddingRight),top:parseFloat(bs.paddingTop),bottom:parseFloat(bs.paddingBottom)};
   const sample=document.createElement('span');sample.style.background='var(--color-popup)';host.append(sample);const popup=getComputedStyle(sample).backgroundColor;sample.remove();
   const visible=e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&s.visibility!=='hidden'&&!e.closest('[inert]')&&r.bottom>h.top&&r.top<h.bottom;};
   const scrollsX=e=>{for(let p=e.parentElement;p&&p!==host;p=p.parentElement){const s=getComputedStyle(p);if(['auto','scroll'].includes(s.overflowX)&&p.scrollWidth>p.clientWidth+1)return true;}return false;};
   const controls=[...body.querySelectorAll('button,input,select,textarea,h1,h2,h3,h4')].filter(visible).filter(e=>!scrollsX(e));
   const escaped=controls.map(e=>{const r=e.getBoundingClientRect();return {text:(e.innerText||e.getAttribute('placeholder')||e.getAttribute('aria-label')||e.tagName).slice(0,70),left:Math.round(r.left-h.left),right:Math.round(h.right-r.right),width:Math.round(r.width)};}).filter(r=>r.left<12||r.right<12);
   const hit=document.elementFromPoint(Math.max(1,h.x+8),Math.min(innerHeight-4,h.y+110));
   return {label:host.getAttribute('aria-label'),content:body.innerText.slice(0,150),gutter,host:{x:h.x,width:h.width,height:h.height},body:{width:b.width,height:b.height,scrollHeight:body.scrollHeight},background:style.backgroundColor,popup,opacity:style.opacity,hitInside:host.contains(hit),escaped};
 });
 results.push({...data,label});return data;
}
try{
 for(const screen of screens){const page=await browser.newPage();page.on('pageerror',e=>errors.push({screen,error:e.message}));await page.setRequestInterception(true);page.on('request',r=>{if(r.url().startsWith(origin)||/^(data:|blob:)/.test(r.url()))r.continue();else if(r.url().includes('pdf.min.js'))r.respond({status:200,contentType:'text/javascript',body:'window.pdfjsLib={GlobalWorkerOptions:{}};'});else r.respond({status:200,contentType:'text/css',body:''});});
 try{await page.goto(`${origin}/_harness/mobile-all.html?screen=${screen}Screen`,{waitUntil:'load',timeout:30000});await page.waitForFunction(()=>!!window.MOBILE_FIXTURE?.getScreen());
 for(const side of ['left','right']){const trigger=await page.$(`[data-mobile-panel="${side}"]`);if(!trigger)continue;await trigger.click();await page.waitForSelector(`.${side}-panel-component.mobile-panel-visible`);await page.waitForFunction(side=>document.querySelector('.'+side+'-panel-component.mobile-panel-visible > .panel-content-wrapper')?.innerText.trim().length>0,{timeout:8000},side);await measure(page,`${screen}/${side}/summary`,`.${side}-panel-component.mobile-panel-visible`);await page.setViewport({width:320,height:844,isMobile:true,hasTouch:true});await wait(60);await measure(page,`${screen}/${side}/summary-320`,`.${side}-panel-component.mobile-panel-visible`);await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});await wait(30);await page.click(`.${side}-panel-component.mobile-panel-visible > .mobile-close-button`);}
 if(['Traces','Workflows','Tools','Skills','Memory','WidgetManager','Marketplace','Plugins','Experiments'].includes(screen)){
  await page.waitForSelector('.m-record-open');await page.click('.m-record-open');await page.waitForSelector('.right-panel-component.mobile-panel-visible');await page.waitForFunction(()=>document.querySelector('.right-panel-component.mobile-panel-visible > .panel-content-wrapper')?.innerText.trim().length>0,{timeout:8000});await wait(100);
  if(screen==='Traces')await page.waitForFunction(()=>document.querySelector('.right-panel-component .selected-execution-section'),{timeout:5000});
  if(['Traces','Workflows'].includes(screen)){await page.click('.right-panel-component.mobile-panel-visible > .mobile-close-button');await page.click('.m-record-open');await page.waitForSelector('.right-panel-component.mobile-panel-visible',{timeout:3000});}
  for(const width of [320,390])for(const theme of ['dark','light']){await page.setViewport({width,height:844,isMobile:true,hasTouch:true});await page.evaluate(theme=>{document.body.classList.remove('dark','light');document.body.classList.add(theme,'custom-bg','has-panel-backdrop');document.body.style.setProperty('--bg-opacity','0.1');},theme);await wait(50);await measure(page,`${screen}/right/selected/${width}/${theme}`,'.right-panel-component.mobile-panel-visible');}
  if(['Traces','Workflows','Skills','Memory'].includes(screen))await page.screenshot({path:output('panel-'+screen+'.png')});
  if(screen==='Traces'){
    for(const type of ['agent','goal']){
      await page.evaluate(type=>{const vm=MOBILE_FIXTURE.getScreen();vm.selectedExecution={...vm.selectedExecution,id:'exec-'+type,workflowName:'Selected '+type+' run',isAgentExecution:type==='agent',isGoalExecution:type==='goal',initialPrompt:'Check the release notes and retain primary-source references.',finalResponse:'The result is ready for review. No publication was performed.',provider:'openai',model:'selected-model',nodeExecutions:[],log:Array.from({length:14},(_,i)=>'Verified step '+i).join('\n')};},type);
      await wait(80);
      await measure(page,'Traces/right/selected-'+type,'.right-panel-component.mobile-panel-visible');
      const layout=await page.evaluate(()=>{const info=document.querySelector('.selected-execution-content');const sections=[...info.children].filter(e=>e.getBoundingClientRect().height>0).map(e=>{const r=e.getBoundingClientRect();return {class:e.className,position:getComputedStyle(e).position,top:r.top,bottom:r.bottom};});return {sections,overlap:sections.some((r,i)=>i>0&&r.top<sections[i-1].bottom-1),overlay:sections.some(r=>r.position==='absolute'||r.position==='fixed')};});
      if(layout.overlap||layout.overlay)errors.push({screen,error:'Selected '+type+' trace sections overlap',layout});
      await page.screenshot({path:output('panel-Traces-'+type+'.png')});
    }
  }
  if(['Traces','Workflows'].includes(screen)){
    const selector=screen==='Traces'?'.right-panel-component.mobile-panel-visible .ui-panel.traces-panel':'.right-panel-component.mobile-panel-visible .workflow-panel';
    await page.$eval(selector,e=>e.scrollTop=0);
    const before=await page.$eval(selector,e=>e.scrollTop);
    const rect=await page.$eval(selector,e=>{const r=e.getBoundingClientRect();return {x:r.x+4,y:Math.min(r.y+180,600)};});await page.mouse.move(rect.x,rect.y);await page.mouse.wheel({deltaY:1800});await wait(200);
    const after=await page.$eval(selector,e=>{const list=[];for(let p=e;p&&list.length<7;p=p.parentElement){const r=p.getBoundingClientRect();list.push({cls:p.className,top:p.scrollTop,range:p.scrollHeight-p.clientHeight,y:r.y,bottom:r.bottom,overflow:getComputedStyle(p).overflowY});}return {top:e.scrollTop,range:e.scrollHeight-e.clientHeight,ancestors:list,hit:document.elementFromPoint(e.getBoundingClientRect().x+4,Math.min(e.getBoundingClientRect().y+180,600))?.className};});
    if(after.range>20&&after.top<=before&&!after.ancestors.some(a=>a.top>20))errors.push({screen,error:'Selected panel content cannot scroll',after});
  }
 }
 if(screen==='WorkflowForge'){
  await page.evaluate(()=>[...document.querySelectorAll('.compact-workflow-controls button')].find(b=>b.innerText==='Add node').click());await page.click('#sidebar .node[data-type="web-search"]');await page.waitForSelector('.right-panel-component.mobile-panel-visible');await wait(100);await measure(page,'WorkflowForge/right/selected-node','.right-panel-component.mobile-panel-visible');
 }

 if(screen==='Settings'){
   await page.evaluate(()=>{const vm=MOBILE_FIXTURE.getScreen();vm.mobileSelectSection({id:'security'});});await wait(80);await page.click('[data-mobile-panel="right"]');await page.waitForSelector('.right-panel-component.mobile-panel-visible');await page.waitForFunction(()=>document.querySelector('.right-panel-component.mobile-panel-visible .panel-content-wrapper')?.innerText.trim().length>0);await measure(page,'Settings/right/security-activity','.right-panel-component.mobile-panel-visible');
 }
 if(screen==='Experiments')for(const view of ['experiments','datasets']){
   await page.evaluate(()=>document.querySelector('.right-panel-component.mobile-panel-visible > .mobile-close-button')?.click());
   await page.evaluate(view=>[...document.querySelectorAll('.view-tab')].find(b=>b.textContent.toLowerCase().includes(view)).click(),view);
   await page.waitForSelector('.m-record-open');await page.click('.m-record-open');await page.waitForSelector('.right-panel-component.mobile-panel-visible');await wait(150);await measure(page,'Experiments/right/'+view+'-selected','.right-panel-component.mobile-panel-visible');
 }
 if(screen==='WorkflowForge')for(const tab of ['Outputs','Docs']){
   await page.evaluate(tab=>[...document.querySelectorAll('.right-panel-component.mobile-panel-visible button')].find(b=>b.innerText.trim()===tab)?.click(),tab);await wait(100);await measure(page,'WorkflowForge/right/node-'+tab,'.right-panel-component.mobile-panel-visible');
 }
 console.log('PANELS',screen,results.filter(r=>r.label.startsWith(screen+'/')).length);
 }catch(e){errors.push({screen,error:e.message});}finally{await page.close();}}
 const failures=results.filter(r=>r.gutter.left<15||r.gutter.right<15||r.gutter.top<12||!r.hitInside||r.background!==r.popup||r.escaped.length);
 const report={count:results.length,results,failures,errors};fs.writeFileSync(output('panel-surfaces.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify({count:results.length,failures,errors},null,2));if(failures.length||errors.length)process.exitCode=1;
}finally{await browser.close();await server.close();}
