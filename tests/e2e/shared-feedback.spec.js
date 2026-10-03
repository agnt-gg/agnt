import { test, expect } from './fixtures/appFixture.js';
import { readdirSync } from 'node:fs';
const businessIcons = readdirSync(new URL('../../frontend/src/assets/icons/', import.meta.url)).filter(name => name.startsWith('business-') && name.endsWith('.svg')).map(name => name.slice(0, -4));
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const sampleItems = ['agent', 'workflow', 'tool', 'skill', 'plugin'].map((type, index) => ({ id: `market-${type}`, asset_id: `starter-${type}`, asset_type: type, title: `Top ${type} starter`, price: 0, downloads: 100 - index, rating: 0, rating_count: 0, category: 'Productivity' }));

// Every spec in a worker shares ONE test account on ONE backend, so a mode set
// by an earlier spec is synced to that account and hydrated into the next one
// (a Focused spec ran first and this file's Studio tests opened in Focused).
// Each test owns its UI mode: the synced preferences are blanked.
async function isolatePreferences(page) {
  await page.route('**/users/preferences**', r => r.fulfill(json({})));
}

async function freeAccount(page) {
  await isolatePreferences(page);
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); localStorage.setItem('uiMode', 'studio'); localStorage.removeItem('selectedProvider'); localStorage.removeItem('selectedModel'); });
  await page.route('**/users/subscription/status', r => r.fulfill(json({ planType: 'free', status: 'active', features: {} })));
  await page.route('**/users/settings', r => r.fulfill(json({ selectedProvider: null, selectedModel: null })));
  await page.route('**/auth/connected', r => r.fulfill(json([])));
  await page.route('**/providers/*/auth/status', r => r.fulfill(json({ available: false, apiUsable: false })));
  await page.route('**/models/agnt/models*', r => r.fulfill(json({ success: true, models: ['agnt-flash'] })));
  await page.route('**/marketplace/items*', r => r.fulfill(json({ items: sampleItems })));
  await page.route('**/teams', r => r.fulfill(json([])));
  // A running LM Studio, as on a real desktop. It must never displace AGNT
  // as a signed-in account's default (it used to win the race and be saved).
  await page.route('http://127.0.0.1:1234/**', r => r.fulfill(json({ data: [{ id: 'nvidia/nemotron-3-nano-4b' }] })));
  await page.route('http://localhost:1234/**', r => r.fulfill(json({ data: [{ id: 'nvidia/nemotron-3-nano-4b' }] })));
  await page.route('**/tenants', r => r.fulfill(json({ tenants: [] })));
}
async function ready(page) { await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters['userAuth/isAuthenticated']); }
async function mode(page, value) { await page.evaluate(async value => { const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store; await store.dispatch('theme/setUiMode', value); }, value); }

test('a free account with zero external providers gets AGNT connected, selected and usable in both modes @ci', async ({ appPage: page }) => {
  await freeAccount(page);
  await page.goto('/chat'); await ready(page); await mode(page, 'studio');
  await page.waitForFunction(() => { const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store; return store.state.aiProvider.selectedProvider === 'AGNT' && store.state.aiProvider.selectedModel === 'agnt-flash'; });
  const actual = await page.evaluate(() => { const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store; return { plan: store.getters['userAuth/planType'], premium: store.getters['userAuth/isPremium'], raw: store.state.appAuth.connectedApps, effective: store.getters['appAuth/connectedApps'] }; });
  expect(actual).toMatchObject({ plan: 'free', premium: false, raw: [], effective: ['agnt'] });
  const composer = page.locator('.input-container textarea');
  await expect(composer).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Change default AI model' })).toContainText(/agnt\/agnt-flash/i);
  await page.getByRole('button', { name: 'Change default AI model' }).click();
  await expect(page.locator('.chat-provider-selector .connection-status .status-text').filter({ hasText: /^Connected$/ }).first()).toBeVisible();
  await mode(page, 'focused');
  await expect(page.locator('.ui-focused .input-container textarea')).toBeEnabled();
  await page.goto('/plugins'); await ready(page); await mode(page, 'focused');
  await expect(page.locator('.focused-card').filter({ hasText: /AGNT Flash|agnt/i }).first()).toContainText('Connected');
});

test('library shelves contain real ranked listings across every Focused asset tab and Market is directly below Plugins @ci', async ({ appPage: page }) => {
  await freeAccount(page);
  await page.goto('/agents'); await ready(page); await mode(page, 'focused');
  const navLabels = await page.locator('.focused-nav > button.focused-nav-row').allTextContents();
  const pluginsIndex = navLabels.findIndex(text => text.trim() === 'Plugins');
  expect(navLabels[pluginsIndex + 1].trim()).toBe('Market');
  for (const [path, title] of [['/agents', 'agent'], ['/workflows', 'workflow'], ['/tools', 'tool'], ['/skills', 'skill'], ['/widget-manager', 'agent'], ['/artifacts', 'agent']]) {
    await page.goto(path); await ready(page); await mode(page, 'focused');
    await expect(page.locator('.ms-row').filter({ hasText: `Top ${title} starter` }).first()).toBeVisible();
    await expect(page.locator('.ms-row-get').first()).toContainText('Install');
  }
  await page.getByRole('button', { name: 'Market', exact: true }).click();
  await expect(page).toHaveURL(/\/marketplace/);
});

test('Studio has a working left chat-panel toggle and legacy Vault opens API/OAuth @ci', async ({ appPage: page }) => {
  await freeAccount(page);
  await page.goto('/chat'); await ready(page); await mode(page, 'studio');
  const toggle = page.locator('.chat-library-toggle');
  await expect(toggle).toBeVisible();
  const before = await page.locator('.left-panel-component').evaluate(el => el.classList.contains('collapsed'));
  await toggle.click();
  await expect.poll(() => page.locator('.left-panel-component').evaluate(el => el.classList.contains('collapsed'))).toBe(!before);
  await toggle.click();
  await expect.poll(() => page.locator('.left-panel-component').evaluate(el => el.classList.contains('collapsed'))).toBe(before);
  await page.goto('/connectors?section=api-keys'); await ready(page); await mode(page, 'studio');
  await expect(page.locator('.content-title').filter({ hasText: 'Auth Connections' })).toBeVisible();
  expect(await page.locator('.left-panel-component').getByText('Vault', { exact: true }).count()).toBe(0);
});

test('business plugin marks fit their dashboard slots, including ViewBox-only SVGs @ci', async ({ appPage: page }) => {
  const icons = businessIcons;
  expect(icons.length).toBeGreaterThan(20);
  await page.route('**/tools/workflow-tools', r => r.fulfill(json({ actions: icons.map((icon, i) => ({ type: `plugin-${i}`, title: icon, icon, category: 'action' })), triggers: [], utilities: [], widgets: [], controls: [], custom: [] })));
  await page.goto('/dashboard'); await ready(page); await mode(page, 'studio');
  await expect(page.locator('.tools-list .tool-icon svg')).toHaveCount(icons.length);
  for (const svg of await page.locator('.tools-list .tool-icon svg').all()) {
    const size = await svg.boundingBox();
    // Layout lands on sub-pixel positions (measured 14.00006); the defect was 300x150.
    expect(size.width).toBeCloseTo(14, 1); expect(size.height).toBeCloseTo(14, 1);
    const fill = await svg.evaluate(el => getComputedStyle(el).fill);
    expect(fill).not.toBe('rgb(1, 5, 42)');
  }
});

test('free workspace gate is readable in light and dark themes and opens Team pricing immediately @ci', async ({ appPage: page }, testInfo) => {
  await freeAccount(page);
  await page.goto('/chat'); await ready(page); await mode(page, 'studio');
  // Open the actual rail Members destination, even when a fresh account has
  // not yet earned the row. Its registry is the source of navigation.
  await page.evaluate(() => {
    localStorage.setItem('agnt:sidebarNavigation:v1', JSON.stringify({ version: 1, groups: ['ASSETS'], items: { 'virtual:teams': { visible: true } } }));
    window.dispatchEvent(new CustomEvent('agnt:navigation-changed'));
  });
  await page.getByRole('button', { name: 'Members', exact: true }).click();
  const gate = page.locator('.pro-gate-locked');
  await expect(gate).toBeVisible();
  await expect(gate).toContainText('Workspaces with AGNT Team');
  for (const theme of ['light', 'cyberpunk']) {
    await page.evaluate(theme => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('theme/setTheme', theme), theme);
    const metrics = await gate.evaluate(el => {
      const color = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = rgb => rgb.map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
      const ratio = (a, b) => (Math.max(lum(color(a)), lum(color(b))) + .05) / (Math.min(lum(color(a)), lum(color(b))) + .05);
      const button = el.querySelector('.pro-gate-cta'), title = el.querySelector('.pro-gate-title');
      return { height: el.getBoundingClientRect().height, textContrast: ratio(getComputedStyle(title).color, getComputedStyle(el).backgroundColor), buttonContrast: ratio(getComputedStyle(button).color, getComputedStyle(button).backgroundColor) };
    });
    expect(metrics.height).toBeGreaterThanOrEqual(240);
    expect(metrics.textContrast).toBeGreaterThanOrEqual(4.5);
    expect(metrics.buttonContrast).toBeGreaterThanOrEqual(4.5);
    await testInfo.attach(`workspace-${theme}`, { body: await gate.screenshot(), contentType: 'image/png' });
  }
  await gate.getByRole('button', { name: 'Upgrade' }).click();
  await expect(page.locator('.upgrade-backdrop[role="dialog"]')).toBeVisible();
  await expect(page.locator('.upgrade-tabs [aria-selected="true"]')).toContainText('AGNT Team');
  await expect(page.locator('.upgrade-tabs [aria-selected="true"]')).toContainText('$99');
});


test('Main-chat shortcuts are absent in both frames without removing new chat or the chat list @ci', async ({ appPage: page }) => {
  await freeAccount(page);
  await page.goto('/chat'); await ready(page); await mode(page, 'studio');
  expect(await page.locator('[data-testid="main-chat-row"]').count()).toBe(0);
  await expect(page.locator('.chat-library-toggle')).toBeVisible();
  await expect(page.locator('.left-panel-component input[placeholder="Search chats..."]')).toBeAttached();
  await mode(page, 'focused');
  expect(await page.locator('[data-testid="focused-main-chat"]').count()).toBe(0);
  expect(await page.locator('.focused-main-chat').count()).toBe(0);
  await expect(page.getByRole('button', { name: 'New chat', exact: true }).first()).toBeVisible();
});


test('free AGNT default sends a real composer request and renders the returned stream @ci', async ({ appPage: page }) => {
  await freeAccount(page);
  let requestBody = null;
  await page.route('**/orchestrator/chat', async route => {
    requestBody = route.request().postDataJSON();
    const event = (name, data) => 'event: ' + name + '\ndata: ' + JSON.stringify(data) + '\n\n';
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body:
      event('conversation_started', { conversationId: 'free-account-chat' }) +
      event('assistant_message', { id: 'free-answer', role: 'assistant', content: '', timestamp: Date.now() }) +
      event('content_delta', { assistantMessageId: 'free-answer', delta: 'The free account reached AGNT Flash.' }) +
      event('done', {}) });
  });
  await page.goto('/chat'); await ready(page); await mode(page, 'studio');
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.aiProvider.selectedModel === 'agnt-flash');
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.criticalDataReady);
  await mode(page, 'studio');
  await expect(page.locator('.chat-library-toggle')).toBeVisible();
  await page.locator('.input-container textarea').fill('Say hello');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => requestBody, { message: (page.__consoleLogs || []).slice(-40).join('\n') }).not.toBeNull();
  // Default mode deliberately lets the server read the saved account pair,
  // rather than pinning a stale browser selection into every request.
  expect(requestBody.routingMode).toBe('default');
  expect(requestBody.message).toBe('Say hello');
  expect(await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.state.aiProvider.selectedModel)).toBe('agnt-flash');
  await expect(page.locator('[data-message-id="free-answer"]')).toContainText('The free account reached AGNT Flash.');
});

for (const width of [1440, 900]) test('Market categories stay compact and separated at ' + width + 'px @ci', async ({ appPage: page }) => {
  await freeAccount(page); await page.setViewportSize({ width, height: 950 });
  await page.goto('/marketplace'); await ready(page); await mode(page, 'studio');
  const tabs = page.locator('.marketplace-panel .tab-button');
  await expect(tabs.first()).toBeVisible();
  const measurements = await tabs.evaluateAll(elements => elements.map(el => ({ height: el.getBoundingClientRect().height, fontSize: parseFloat(getComputedStyle(el).fontSize), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })));
  expect(measurements.length).toBeGreaterThan(3);
  for (let i = 0; i < measurements.length; i++) {
    expect(measurements[i].height).toBeLessThanOrEqual(36);
    expect(measurements[i].fontSize).toBeLessThanOrEqual(12);
    if (i) expect(measurements[i].left - measurements[i - 1].right).toBeGreaterThanOrEqual(7);
  }
});


// Reported: a new page was saved into the retired Main chat and vanished from
// the list. Real backend: no Main chat is created, and /chat opens a new one.
test('a fresh /chat is a new conversation, never the Main chat @ci', async ({ appPage: page }) => {
  await freeAccount(page);
  const mainCalls = [];
  page.on('response', async r => { if (/\/content-outputs\/main-chat$/.test(r.url())) mainCalls.push(await r.json().catch(() => null)); });
  await page.goto('/chat'); await ready(page);
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.criticalDataReady);
  await page.waitForTimeout(1500);
  const state = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
    return { saved: store.state.chat.savedOutputId, title: store.state.chat.savedOutputTitle, mainId: store.getters['contentOutputs/mainChatId'],
      mainRows: (store.getters['contentOutputs/outputs'] || []).filter((o) => o.title === 'Main chat').length };
  });
  expect(state).toEqual({ saved: null, title: null, mainId: null, mainRows: 0 });
  for (const body of mainCalls) expect(body?.main ?? null).toBeNull();
});


// Reported: after signing into another account, the chat said no AI provider
// was connected until a refresh. A page load waits for connections before it
// draws the greeting; an account switch did not, and never redrew it. Here
// the session ends and a new one starts in the same page, as a sign-in does,
// and the new account's connections arrive late.
test('after an account switch the greeting catches up when connections arrive late @ci', async ({ appPage: page }) => {
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); localStorage.setItem('uiMode', 'studio'); });
  await isolatePreferences(page);
  let connectedDelayMs = 0;
  await page.route('**/users/settings', r => r.fulfill(json({ selectedProvider: 'OpenAI', selectedModel: 'gpt-4o' })));
  await page.route('**/models/*/models*', r => r.fulfill(json({ success: true, models: ['gpt-4o'] })));
  await page.route('**/providers/*/auth/status', r => r.fulfill(json({ available: false, apiUsable: false })));
  await page.route('**/auth/connected', async r => { await new Promise(done => setTimeout(done, connectedDelayMs)); await r.fulfill(json(['openai'])); });
  await page.goto('/chat');
  await expect(page.getByText("Hi! I'm Annie, your personal AI assistant.")).toBeVisible({ timeout: 15000 });

  connectedDelayMs = 3000;
  await page.evaluate(async () => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
    store.commit('userAuth/SET_SESSION_STATE', 'invalid');
    await new Promise(done => setTimeout(done, 200));
    store.commit('userAuth/SET_SESSION_STATE', 'valid');
  });
  // The new session's chat is drawn before its connections land...
  await expect(page.locator('.setup-message')).toBeVisible({ timeout: 2500 });
  // ...and must catch up when they do, without a reload.
  await expect(page.locator('.setup-message')).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByText("Hi! I'm Annie, your personal AI assistant.")).toBeVisible();
  await expect(page.locator('.input-container textarea')).toBeEnabled();
});
