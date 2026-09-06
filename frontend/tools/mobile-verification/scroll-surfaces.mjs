import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fixtureServer } from './fixture-server.mjs';
import { output } from './paths.mjs';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');
const server = await fixtureServer();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-first-run', '--js-flags=--max-old-space-size=512'], defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true } });
const checks = [], errors = [], measurements = [];
const viewportWidth = Number(process.env.AGNT_SCROLL_TEST_WIDTH || 390);
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, pass, evidence) => checks.push({ name, pass: !!pass, evidence });
async function setup(name) {
  const page = await browser.newPage();
  await page.setViewport({ width: viewportWidth, height: 844, isMobile: true, hasTouch: true });
  page.on('pageerror', e => errors.push({ screen: name, error: e.message }));
  await page.setRequestInterception(true);
  page.on('request', r => {
    if (r.url().startsWith(origin) || /^(data:|blob:)/.test(r.url())) r.continue();
    else r.respond({ status: 200, contentType: 'text/css', body: '' });
  });
  await page.goto(`${origin}/_harness/mobile-all.html?screen=${name}Screen`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForFunction(() => !!window.MOBILE_FIXTURE?.getScreen());
  return page;
}
async function measure(page, selector) {
  return page.$eval(selector, el => {
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    return { selector: el.className, top: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: style.overflowY, flex: style.flex, height: rect.height, y: rect.y, bottom: rect.bottom };
  });
}
async function scrollWithInput(page, selector, name) {
  const before = await measure(page, selector);
  const rect = await page.$eval(selector, e => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; });
  // Wheel over the outer gutter: must move the page/stack, not an embedded widget.
  await page.mouse.move(rect.x + 3, Math.max(120, Math.min(rect.y + 170, 650)));
  await page.mouse.wheel({ deltaY: 520 });
  await new Promise(r => setTimeout(r, 180));
  const after = await measure(page, selector);
  check(name + ' scrolls with wheel', after.top > before.top + 20, { before, after });
  await page.$eval(selector, e => { e.scrollTop=0; });
  const cdp = await page.createCDPSession();
  const x=Math.round(rect.x+3), y=Math.round(Math.min(rect.y+rect.height-45,730));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let step=1;step<=8;step++) { await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-step*35}]}); await new Promise(r=>setTimeout(r,18)); }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await new Promise(r=>setTimeout(r,250));
  const swipe = await measure(page, selector);
  check(name + ' scrolls with touch', swipe.top > 20, swipe);
  await cdp.detach();
  // Reach the last direct content item through wheel input, not scrollTop assignment.
  for(let i=0;i<8;i++) { await page.mouse.move(rect.x + 3, Math.max(120, Math.min(rect.y + 170, 650))); await page.mouse.wheel({deltaY:650}); await new Promise(r=>setTimeout(r,80)); }
  await new Promise(r=>setTimeout(r,250));
  const end=await measure(page,selector);
  end.hit = await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.className,{x:rect.x+3,y:Math.max(120,Math.min(rect.y+170,650))});
  check(name + ' reaches end', end.scrollHeight-end.clientHeight-end.top<4 && end.scrollHeight>end.clientHeight+30,end);
  if (['.dashboard-content','.ws-canvas','.widget-canvas'].includes(selector)) {
    await page.$eval(selector, e=>{e.scrollTop=0;e.focus({preventScroll:true});});
    await page.keyboard.press('PageDown');
    await settle(200);
    const keyboard=await measure(page,selector);
    check(name + ' scrolls with keyboard', keyboard.top>20, keyboard);
  }
  measurements.push({name,before,after,swipe,end});
}
try {
  const dashboard = await setup('Dashboard');
  await dashboard.waitForSelector('.dashboard-grid .middle-row');
  await scrollWithInput(dashboard, '.dashboard-content', 'Dashboard');
  await dashboard.screenshot({path:output('scroll-dashboard.png')});
  await dashboard.setViewport({width:1280,height:900,isMobile:true,hasTouch:true});
  await settle(150);
  check('Dashboard desktop layout is unchanged',await dashboard.$eval('.dashboard-content',e=>getComputedStyle(e).overflowY==='hidden'));
  await dashboard.close();

  const workspace = await setup('Workspace');
  await workspace.evaluate(() => { for(const widgetId of ['goals-map','agents-swarm','runs-queue']) MOBILE_FIXTURE.getScreen().pick({widgetId}); });
  await workspace.waitForFunction(() => document.querySelectorAll('.ws-surfaces .widget-frame').length >= 4);
  const workspaceLayout = await workspace.evaluate(() => JSON.stringify(MOBILE_FIXTURE.getScreen().active.widgets));
  await scrollWithInput(workspace, '.ws-canvas', 'Workspace with four widgets');
  check('Workspace scroll preserves desktop layout',await workspace.evaluate(before=>JSON.stringify(MOBILE_FIXTURE.getScreen().active.widgets)===before,workspaceLayout));
  await workspace.screenshot({path:output('scroll-workspace.png')});
  await workspace.setViewport({width:1280,height:900,isMobile:true,hasTouch:true});
  await settle(150);
  check('Workspace returns to desktop canvas layout',await workspace.$eval('.ws-canvas',e=>getComputedStyle(e).overflowY==='hidden'));
  await workspace.close();

  // Test the gesture where people actually put a thumb: inside the leading
  // conversation widget, not just in the narrow outside gutter.
  const nestedWorkspace = await setup('Workspace');
  await nestedWorkspace.evaluate(() => { for(const widgetId of ['goals-map','agents-swarm','runs-queue']) MOBILE_FIXTURE.getScreen().pick({widgetId}); });
  await nestedWorkspace.waitForFunction(() => document.querySelectorAll('.ws-surfaces .widget-frame').length >= 4);
  await nestedWorkspace.evaluate(() => { document.querySelector('.ws-canvas').scrollTop=0; });
  await nestedWorkspace.mouse.move(190,420);
  for(let i=0;i<10;i++){await nestedWorkspace.mouse.wheel({deltaY:450});await new Promise(r=>setTimeout(r,70));}
  const nestedEnd=await measure(nestedWorkspace,'.ws-canvas');
  check('Workspace scroll chains from widget content to later widgets',nestedEnd.top>500,nestedEnd);
  await nestedWorkspace.close();

  const custom = await setup('Chat');
  await custom.evaluate(() => {
    const store=MOBILE_FIXTURE.store;
    store.commit('widgetLayout/ADD_PAGE',{id:'scroll-custom',name:'Scroll review',route:'scroll-review'});
    store.commit('widgetLayout/SET_LAYOUT',{pageId:'scroll-custom',layout:['goals-map','agents-swarm','runs-queue','goals-map'].map((widgetId,i)=>({instanceId:'scroll-'+i,widgetId,col:i%2*5,row:Math.floor(i/2)*4,cols:5,rows:4,visible:true,zIndex:i+1}))});
  });
  await custom.click('.cv-mobile-menu');
  await custom.evaluate(()=>[...document.querySelectorAll('.cv-sidebar .cv-sb-page')].find(b=>b.textContent.includes('Scroll review')).click());
  await custom.waitForSelector('.widget-canvas .widget-frame');
  const customLayout=await custom.evaluate(()=>JSON.stringify(MOBILE_FIXTURE.store.state.widgetLayout.layouts['scroll-custom']));
  await scrollWithInput(custom, '.widget-canvas', 'Custom page with four widgets');
  check('Custom-page scroll preserves desktop layout',await custom.evaluate(before=>JSON.stringify(MOBILE_FIXTURE.store.state.widgetLayout.layouts['scroll-custom'])===before,customLayout));
  await custom.screenshot({path:output('scroll-custom.png')});
  await custom.setViewport({width:1280,height:900,isMobile:true,hasTouch:true});
  await settle(150);
  check('Custom page keeps desktop clipping outside compact mode',await custom.$eval('.widget-canvas',e=>getComputedStyle(e).overflowY==='hidden'));
  await custom.close();

  const chrome = await setup('Chat');
  await chrome.waitForSelector('[data-mobile-panel="left"]');
  for(const expanded of [true,false]) {
    await chrome.evaluate(expanded=>{document.querySelector('.cv-root').__vueParentComponent.proxy.isSidebarExpanded=expanded;},expanded);
    await chrome.click('.cv-mobile-menu');
    const captions=await chrome.$$eval('.cv-sb-cap',els=>els.map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el),text=el.querySelector('.cv-sb-cap-text').getBoundingClientRect(),nav=el.closest('.cv-sidebar').getBoundingClientRect();return {name:el.textContent.trim(),height:r.height,leftInset:text.left-nav.left,paddingLeft:s.paddingLeft,paddingTop:s.paddingTop,display:s.display};}));
    check(`Navigation group spacing, desktop expanded=${expanded}`,captions.every(c=>c.height>=26&&c.leftInset>=15&&parseFloat(c.paddingTop)>=8),captions);
    const labels=await chrome.$$eval('.cv-sidebar .cv-sb-page',buttons=>buttons.map(b=>{const label=b.querySelector('.cv-sb-label');return {label:label?.textContent.trim(),width:b.getBoundingClientRect().width,visibleWidth:label?.clientWidth,requiredWidth:label?.scrollWidth};}));
    check(`Full navigation labels, desktop expanded=${expanded}`,labels.every(l=>l.width>200&&l.visibleWidth>=l.requiredWidth),labels);
    await chrome.screenshot({path:output('navigation-spacing-'+expanded+'.png')});
    await chrome.click('.cv-mobile-nav-close');
  }
  for(const theme of ['dark','light']) for(const wallpaper of [false,true]) {
    await chrome.evaluate(({theme,wallpaper})=>{document.body.classList.remove('dark','light');document.body.classList.add(theme);document.body.classList.toggle('custom-bg',wallpaper);document.body.classList.toggle('has-panel-backdrop',wallpaper);document.body.style.setProperty('--bg-opacity','0.15');}, {theme,wallpaper});
    for(const side of ['left','right']) {
      await chrome.click(`[data-mobile-panel="${side}"]`);
      await chrome.waitForSelector(`.${side}-panel-component.mobile-panel-visible`);
      const paint=await chrome.$eval(`.${side}-panel-component`,el=>{const s=getComputedStyle(el);const sample=document.createElement('div');sample.style.background='var(--color-popup)';el.append(sample);const token=getComputedStyle(sample).backgroundColor;sample.remove();return {background:s.backgroundColor,token,opacity:s.opacity,image:s.backgroundImage,filter:s.backdropFilter};});
      check(`${side} overlay uses popup theme, ${theme}, wallpaper=${wallpaper}`,paint.background===paint.token&&paint.background!=='rgba(0, 0, 0, 0)'&&paint.opacity==='1',paint);
      await chrome.screenshot({path:output(`overlay-${side}-${theme}-${wallpaper}.png`)});
      await chrome.click(`.${side}-panel-component .mobile-close-button`);
    }
  }
  await chrome.close();
  for(const scenario of [
    {screen:'Agents',selector:'.m-collection',prepare:()=>{const vm=MOBILE_FIXTURE.getScreen(),base=MOBILE_FIXTURE.agents[0];vm.agents=Array.from({length:30},(_,i)=>({...base,id:'agent-scroll-'+i,name:'Research '+i}));},ready:()=>document.querySelectorAll('.m-collection .m-record').length===30},
    {screen:'Settings',selector:'.m-directory'},
    {screen:'Settings',selector:'.mobile-section-body',prepare:()=>{const vm=MOBILE_FIXTURE.getScreen();vm.mobileSelectSection({id:'providers'});},ready:()=>document.querySelector('.mobile-section-body')?.innerText.includes('Custom Instructions')},
    {screen:'AgentForge',selector:'.scrollable-content',ready:()=>document.querySelector('.agentforge-content')?.innerText.includes('Description')},
    {screen:'Plugins',selector:'.scrollable-content',prepare:()=>{const p=document.querySelector('.plugins-container').__vueParentComponent.proxy;p.activeTab='publish';},ready:()=>document.querySelector('.plugins-container')?.innerText.includes('Select Plugin')},
  ]){
    const page=await setup(scenario.screen);
    if(scenario.prepare)await page.evaluate(scenario.prepare);
    if(scenario.ready)await page.waitForFunction(scenario.ready,{timeout:10000});
    await new Promise(r=>setTimeout(r,180));
    const selectors=await page.evaluate(()=>[...document.querySelectorAll('.cv-dashboard *')].filter(e=>e.scrollHeight>e.clientHeight+40&&e.getBoundingClientRect().height>100&&!e.closest('[inert]')).map(e=>({class:e.className,scroll:e.scrollHeight,height:e.clientHeight,overflow:getComputedStyle(e).overflowY})).slice(0,16));
    const present=await page.$(scenario.selector);
    if(present){const available=await measure(page,scenario.selector);if(available.scrollHeight>available.clientHeight+30)await scrollWithInput(page,scenario.selector,scenario.screen+' '+scenario.selector);else measurements.push({name:scenario.screen+' '+scenario.selector,available,scrollCandidates:selectors});}else measurements.push({name:scenario.screen,scrollCandidates:selectors});
    await page.close();
  }
  const result={viewportWidth,checks,errors,measurements};
  fs.writeFileSync(output('scroll-surfaces.json'),JSON.stringify(result,null,2),{flag:'wx'});
  console.log(JSON.stringify(result,null,2));
  if(errors.length||checks.some(c=>!c.pass))process.exitCode=1;
} finally { await browser.close(); await server.close(); }
