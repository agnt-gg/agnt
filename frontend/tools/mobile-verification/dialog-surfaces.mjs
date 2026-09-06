import fs from 'node:fs';import {createRequire} from 'node:module';import {fixtureServer} from './fixture-server.mjs';import {output} from './paths.mjs';const require=createRequire(import.meta.url),puppeteer=require('puppeteer');
const server=await fixtureServer(),origin=`http://127.0.0.1:${server.httpServer.address().port}`;
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run','--js-flags=--max-old-space-size=512'],defaultViewport:{width:390,height:844,isMobile:true,hasTouch:true}});
const cases=[
 {screen:'Goals',name:'create-goal',flag:'showCreateModal',selector:'.modal-container'},
 {screen:'Goals',name:'schedule-goal',method:'openScheduleModal',argument:'goal',selector:'.modal-card'},
 {screen:'Memory',name:'create-memory',click:'.m-create',selector:'.modal-content'},
 {screen:'Skills',name:'create-skill',click:'.m-create',selector:'.modal-content'},
 {screen:'Experiments',name:'new-experiment',flag:'showForgeModal',selector:'.modal-content'},
 {screen:'Experiments',name:'generate-dataset',flag:'showGenerateModal',selector:'.modal-content'},
 {screen:'Experiments',name:'evolution-settings',flag:'showSettingsModal',selector:'.modal-content'},
 {screen:'WidgetManager',name:'import-widget',flag:'showImportModal',selector:'.wm-modal'},
 {screen:'AgentForge',name:'select-tools',flag:'showToolsModal',selector:'.modal-content'},
 {screen:'AgentForge',name:'select-skills',flag:'showSkillsModal',selector:'.modal-content'},
 {screen:'Connectors',name:'add-provider',flag:'showAddProviderModal',selector:'.mcp-server-form'},
 {screen:'Workflows',name:'publish-from-detail',select:true,nestedFlag:'showPublishModal',nestedRoot:'.workflow-panel',selector:'.modal-content'},
];
const checks=[],errors=[];
try{for(const c of cases){const page=await browser.newPage();page.on('pageerror',e=>errors.push({name:c.name,error:e.message}));await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(origin)||/^(data:|blob:)/.test(r.url())?r.continue():r.respond({status:200,contentType:'text/css',body:''}));try{
 await page.goto(`${origin}/_harness/mobile-all.html?screen=${c.screen}Screen`,{waitUntil:'load'});await page.waitForFunction(()=>!!window.MOBILE_FIXTURE?.getScreen());
 if(c.select){await page.click('.m-record-open');await page.waitForSelector(c.nestedRoot);}
 if(c.screen==='Experiments'){
   if(c.flag==='showForgeModal'||c.flag==='showGenerateModal'){await page.evaluate(flag=>[...document.querySelectorAll('.view-tab')].find(b=>b.innerText.includes(flag==='showForgeModal'?'Experiments':'Datasets')).click(),c.flag);await page.click('.m-create');}
   else {await page.click('.m-options summary');await page.evaluate(()=>[...document.querySelectorAll('.m-options-content button')].find(b=>b.innerText==='Evolution Settings').click());}
 }else if(c.click){await page.click(c.click);}else await page.evaluate(c=>{const vm=c.nestedRoot?document.querySelector(c.nestedRoot).__vueParentComponent.proxy:MOBILE_FIXTURE.getScreen();if('mobileDirectoryOpen' in vm)vm.mobileDirectoryOpen=false;const setup=vm.$?.setupState||vm;if(c.method){(setup[c.method]||vm[c.method])(c.argument==='goal'?MOBILE_FIXTURE.goals[0]:undefined);}else{const key=c.nestedFlag||c.flag;if(c.screen==='Experiments'){if(key==='showForgeModal')setup.activeView='experiments';if(key==='showGenerateModal')setup.activeView='datasets';if(key==='showSettingsModal')setup.openSettings();else setup.handleCreate();}else {const target=vm.$?.setupState&&key in vm.$.setupState?vm.$.setupState:vm;target[key]=true;}}},c);
 await page.waitForSelector(c.selector,{visible:true,timeout:8000});
 for(const width of [320,390]){await page.setViewport({width,height:844,isMobile:true,hasTouch:true});await page.evaluate(()=>document.body.classList.add('custom-bg','has-panel-backdrop'));await new Promise(r=>setTimeout(r,60));
 const measured=await page.$eval(c.selector,el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);const probe=document.createElement('i');probe.style.background='var(--color-popup)';el.append(probe);const expected=getComputedStyle(probe).backgroundColor;probe.remove();const visibleControls=[...el.querySelectorAll('input,textarea,button,h2,h3')].filter(n=>{const b=n.getBoundingClientRect();return b.width&&b.height&&getComputedStyle(n).visibility!=='hidden'&&b.top<r.bottom&&b.bottom>r.top;});const edges=visibleControls.map(n=>{const b=n.getBoundingClientRect();return {label:(n.innerText||n.placeholder||n.tagName).slice(0,40),left:b.left-r.left,right:r.right-b.right};}).filter(b=>b.left<12||b.right<12);const top=document.elementFromPoint(Math.max(r.left+8,1),Math.max(r.top+10,1));return{bounds:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},padding:s.padding,background:s.backgroundColor,expected,hitInside:el.contains(top),edges};});
 checks.push({name:c.name,width,...measured,pass:measured.bounds.x>=4&&measured.bounds.right<=width-4&&measured.bounds.bottom<=844&&measured.bounds.y>=0&&measured.background===measured.expected&&measured.hitInside&&!measured.edges.length});
 }await page.screenshot({path:output('dialog-'+c.name+'.png')});
 }catch(e){errors.push({name:c.name,error:e.message});}finally{await page.close();}console.log('DIALOG',c.name);}
 for(const screen of ['Agents','Goals']){const page=await browser.newPage();await page.goto(`${origin}/_harness/mobile-all.html?screen=${screen}Screen`,{waitUntil:'load'});await page.waitForSelector('.m-record-open');await page.click('.m-record-open');const selector=screen==='Agents'?'.agent-details-section':'.goal-detail-view';await page.waitForSelector(selector,{visible:true});await page.evaluate(()=>document.body.classList.add('custom-bg','has-panel-backdrop'));const data=await page.$eval(selector,el=>{const style=getComputedStyle(el),r=el.getBoundingClientRect(),p=document.createElement('i');p.style.background='var(--color-popup)';el.append(p);const popup=getComputedStyle(p).backgroundColor;p.remove();return{background:style.backgroundColor,popup,width:r.width};});checks.push({name:screen+' inline detail',...data,pass:data.background===data.popup});await page.close();}
 fs.writeFileSync(output('dialog-surfaces.json'),JSON.stringify({checks,errors},null,2),{flag:'wx'});console.log(JSON.stringify({checks:checks.length,failed:checks.filter(c=>!c.pass),errors},null,2));if(checks.some(c=>!c.pass)||errors.length)process.exitCode=1;
}finally{await browser.close();await server.close();}
