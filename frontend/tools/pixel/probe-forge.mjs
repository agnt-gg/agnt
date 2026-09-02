// Real Workflow Forge in three states: empty · node selected · edge selected.
// Builds the graph live (synthetic drops + a port drag) so the right panel
// shows what it really shows. Read-only against the repo.
import { createRequire } from 'node:module';
import fs from 'node:fs';
const FE = 'C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro.wt/agnt-one/frontend';
const require = createRequire(FE + '/package.json');
const { chromium } = require('playwright');
const { serveDist } = await import('file:///' + FE + '/tools/pixel/serve.mjs');
const { resolveFixture, FIXTURE_USER, FIXTURE_TOKEN } = await import('file:///' + FE + '/tools/pixel/fixtures.mjs');
const OUT = FE + '/tools/pixel/shots-one/forge-';
const seed = ({ user, token }) => {
  const set = (k, v) => localStorage.setItem(k, v);
  set('token', token); set('user', JSON.stringify(user)); set('userId', user.id);
  set('onboardingCompleted', 'true'); set('hasSeenOnboarding', 'true'); set('hasCompletedOnboarding', 'true'); set('tours_enabled', 'false'); set('tours_auto_start', 'false');
  set('currentTheme', 'dark'); set('uiScale', '100'); set('showLeftPanel', 'true'); set('showRightPanel', 'true'); set('leftPanelWidth', '260'); set('actualLeftPanelWidth', '260'); set('rightPanelWidth', '320');
  set('isPromoBannerClosed', 'true'); set('isRateLimitBannerClosed', 'true'); set('agnt:canvasSidebar:expanded', 'true');
  const css = `*,*::before,*::after{animation-duration:1ms!important;transition-duration:1ms!important;caret-color:transparent!important}.scanline-overlay,.scanlines{display:none!important}`;
  const inject = () => { if (!document.head && !document.documentElement) return false; const st = document.createElement('style'); st.textContent = css; (document.head || document.documentElement).appendChild(st); return true; };
  if (!inject()) document.addEventListener('DOMContentLoaded', inject, { once: true });
};
const { server, origin } = await serveDist(FE + '/dist');
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });
await ctx.addInitScript(seed, { user: FIXTURE_USER, token: FIXTURE_TOKEN });
const LIB = JSON.parse(fs.readFileSync('C:/Users/Studio/Documents/DevelopmentProjects/AGNT/repos/agnt-pro/backend/src/tools/toolLibrary.json', 'utf8'));
await ctx.route('**/*', async (r) => { const url = r.request().url(); if (/socket\.io|\/ws(\?|$)/.test(url)) return r.abort(); if (/\/api\/tools\/workflow-tools/.test(url)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIB) }); if (/\/api\//.test(url)) { const f = resolveFixture(new URL(url).pathname); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(f === null ? [] : f) }); } if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) return r.abort(); return r.continue(); });
await ctx.clock.install({ time: new Date('2026-09-02T09:41:00Z') }); await ctx.clock.setFixedTime(new Date('2026-09-02T09:41:00Z'));
const page = await ctx.newPage();
await page.goto(origin + '/workflow-forge', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#sidebar .node.starter', { timeout: 20000 });
await page.waitForTimeout(1500);
const all = await page.$$eval('#sidebar .node.starter', els => els.map(e => ({ type: e.dataset.type, category: e.dataset.category, text: e.innerText.trim().split('\n')[0] })));
console.log('palette:', all.length, JSON.stringify(all.slice(0, 5)));
const tools = [all.find(t => t.type === 'trigger-timer') || all[0], all.find(t => t.type === 'generate-with-ai-llm') || all[3]];
await page.screenshot({ path: OUT + 'workflow-forge-empty.png' });
const drop = async (tool, x, y) => {
  await page.evaluate(({ tool, x, y }) => {
    const target = document.getElementById('canvas');
    const dt = new DataTransfer(); dt.setData('text/plain', JSON.stringify({ text: tool.text, type: tool.type, category: tool.category }));
    const r = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: r.left + x, clientY: r.top + y, dataTransfer: dt }));
  }, { tool, x, y });
  await page.waitForTimeout(500);
};
await drop(tools[0], 520, 330);
await drop(tools[1], 900, 330);
const nodeSel = await page.evaluate(() => [...document.querySelectorAll('#canvas .node')].map(n => n.className));
console.log('canvas nodes:', JSON.stringify(nodeSel));
const canvasNodes = page.locator('#canvas .node');
await page.screenshot({ path: OUT + 'workflow-forge-2nodes.png' });
// select node 1
await canvasNodes.nth(0).click({ position: { x: 40, y: 14 } });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 'workflow-forge-node.png' });
const rp = await page.evaluate(() => (document.querySelector('.right-panel-component')?.innerText || '').replace(/\s+/g, ' ').slice(0, 600));
console.log('RIGHT(node):', rp);
// select edge
await page.mouse.click(1040, 800); await page.waitForTimeout(600);
console.log('RIGHT(after deselect):', await page.evaluate(() => (document.querySelector('.right-panel-component')?.innerText || '').replace(/\s+/g, ' ').slice(0, 160)));
await page.screenshot({ path: OUT + 'workflow-forge-2nodes.png' });
const eb = await page.evaluate(() => { const p = document.querySelector('path.invisible-hitarea'); if (!p) return null; p.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); const b = p.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; });
console.log('edge box:', eb, 'edges in designer:', await page.evaluate(() => document.querySelectorAll('#canvas svg path.invisible-hitarea').length));
if (eb) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + 'workflow-forge-edge.png' });
  console.log('RIGHT(edge):', await page.evaluate(() => (document.querySelector('.right-panel-component')?.innerText || '').replace(/\s+/g, ' ').slice(0, 900)));
}
await page.mouse.click(1040, 800); await page.waitForTimeout(600);
console.log('RIGHT(none):', await page.evaluate(() => (document.querySelector('.right-panel-component')?.innerText || '').replace(/\s+/g, ' ').slice(0, 300)));
await page.screenshot({ path: OUT + 'none.png' });
console.log('LEFT title:', await page.evaluate(() => document.querySelector('.left-panel-component h2, .left-panel-component .title')?.innerText));
await browser.close(); server.close();
