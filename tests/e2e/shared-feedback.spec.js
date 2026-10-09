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
  // AI models are not plugins (Connectors.vue openAiModels): Focused shows the
  // account's model under Settings, Default model.
  await page.goto('/settings'); await ready(page); await mode(page, 'focused');
  await expect(page.locator('.ui-focused .selected-label').filter({ hasText: /^AGNT$/ }).first()).toBeVisible();
  await expect(page.locator('.ui-focused .selected-label').filter({ hasText: /^agnt-flash$/ }).first()).toBeVisible();
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
  // The legacy ?section=api-keys link lands on the keys-and-sign-ins section,
  // named Vault since fef1f2311, with its own row of the Plugins sidebar active.
  await page.goto('/connectors?section=api-keys'); await ready(page); await mode(page, 'studio');
  await expect(page.locator('.content-title').filter({ hasText: 'Vault' })).toBeVisible();
  await expect(page.locator('.connectors-panel [data-nav="oauth"]')).toHaveClass(/active/);
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
  // Members is a section of Settings since 45315e6d1, not a rail row.
  await page.goto('/settings'); await ready(page); await mode(page, 'studio');
  await page.locator('[data-nav="members"]').click();
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
  // The plan tabs are PlanPicker's since 7f59642de (.plan-tabs, still a tablist).
  await expect(page.locator('.plan-tabs [role="tab"][aria-selected="true"]')).toContainText('AGNT Team');
  await expect(page.locator('.plan-tabs [role="tab"][aria-selected="true"]')).toContainText('$99');
});


// The Main chat is pinned again (texts to Annie land in it). It sits beside
// New chat and the chat list, never instead of them.
test('the Main chat is pinned once in both frames, beside new chat and the chat list @ci', async ({ appPage: page }) => {
  await freeAccount(page);
  await page.goto('/chat'); await ready(page); await mode(page, 'studio');
  await expect(page.locator('[data-testid="main-chat-row"]')).toHaveCount(1);
  await expect(page.locator('.chat-library-toggle')).toBeVisible();
  await expect(page.locator('.left-panel-component input[placeholder="Search chats..."]')).toBeAttached();
  await mode(page, 'focused');
  await expect(page.locator('[data-testid="focused-main-chat"]')).toHaveCount(1);
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


// Reported (Oct 3): a new page was saved into the Main chat while its row was
// hidden, and vanished. The Main chat exists and is pinned again, and /chat
// still opens a conversation of its own, never the Main chat.
test('a fresh /chat is a new conversation, never the Main chat @ci', async ({ appPage: page }) => {
  await freeAccount(page);
  await page.goto('/chat'); await ready(page);
  await page.waitForFunction(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters.criticalDataReady);
  await page.waitForFunction(() => !!document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters['contentOutputs/mainChatId']);
  const state = await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
    return { saved: store.state.chat.savedOutputId, title: store.state.chat.savedOutputTitle, mainId: store.getters['contentOutputs/mainChatId'],
      mainRows: (store.getters['contentOutputs/outputs'] || []).filter((o) => o.title === 'Main chat').length };
  });
  expect(state.saved).toBeNull();
  expect(state.title).toBeNull();
  expect(state.mainId).toBeTruthy();
  expect(state.mainRows).toBe(1);
});


// Reported: after signing into another account, the chat said no AI provider
// was connected until a refresh. A page load waits for connections before it
// draws the greeting; an account switch did not, and never redrew it. Here
// the session ends and a new one starts in the same page, as a sign-in does,
// and the new account's connections arrive late.
// A signed-in account always has AGNT Flash (chatProvider.js, d916cc445), so
// the greeting no longer depends on connections at all: the new session must
// never show the setup card, even while its connections are still loading.
test('after an account switch the greeting is Annie at once, even while connections arrive late @ci', async ({ appPage: page }) => {
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
  // Connections land 3s after the switch; well before that, the chat is ready.
  await page.waitForTimeout(1000);
  await expect(page.locator('.setup-message')).toHaveCount(0);
  await expect(page.getByText("Hi! I'm Annie, your personal AI assistant.")).toBeVisible();
  await expect(page.locator('.input-container textarea')).toBeEnabled();
  // ...and nothing changes when they do arrive.
  await page.waitForTimeout(3000);
  await expect(page.locator('.setup-message')).toHaveCount(0);
  await expect(page.getByText("Hi! I'm Annie, your personal AI assistant.")).toBeVisible();
});


const studio = async (page, path) => {
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); localStorage.setItem('uiMode', 'studio'); });
  await isolatePreferences(page);
  await page.goto(path);
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
};

test('Settings: no Notifications page, and the Layout chooser leads the Theme page @ci', async ({ appPage: page }) => {
  await studio(page, '/settings');
  await expect(page.locator('[data-nav="theme"]')).toBeVisible();
  expect(await page.locator('[data-nav="notifications"]').count()).toBe(0);
  await page.locator('[data-nav="theme"]').click();
  const theme = page.locator('[data-section="theme"]');
  await expect(theme.getByRole('radiogroup', { name: 'Layout' })).toBeVisible();
  // Above the theme cards, not below them.
  const layoutTop = await theme.locator('.ui-mode-setting').evaluate(el => el.getBoundingClientRect().top);
  const themesTop = await theme.locator('.lower-section').evaluate(el => el.getBoundingClientRect().top);
  expect(layoutTop).toBeLessThan(themesTop);
  await theme.getByTestId('ui-mode-focused').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters['theme/uiMode'])).toBe('focused');
});

for (const themeName of ['cyberpunk', 'light']) test('API Key page has real spacing and the app fonts in ' + themeName + ' @ci', async ({ appPage: page }, testInfo) => {
  await studio(page, '/settings');
  await page.evaluate(t => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('theme/setTheme', t), themeName);
  await page.locator('[data-nav="api-keys"]').click();
  const section = page.locator('[data-section="api-keys"]');
  const card = section.locator('.api-card, .pro-gate-locked').first();
  await expect(card).toBeVisible();
  const box = await card.evaluate(el => { const c = getComputedStyle(el); return { pl: parseFloat(c.paddingLeft), pt: parseFloat(c.paddingTop), font: c.fontFamily, radius: parseFloat(c.borderTopLeftRadius) }; });
  expect(box.pl).toBeGreaterThanOrEqual(18);
  expect(box.pt).toBeGreaterThanOrEqual(18);
  expect(box.radius).toBeGreaterThanOrEqual(10);
  const bodyFont = await page.evaluate(() => getComputedStyle(document.querySelector('[data-section="api-keys"] .content-title')).fontFamily);
  expect(box.font).toBe(bodyFont);
  await section.screenshot({ path: testInfo.outputPath('api-key-' + themeName + '.png') });
  await page.screenshot({ path: 'C:/Users/Studio/AppData/Roaming/AGNT/projects/updater-067-mobile-evidence-01/api-key-' + themeName + '.png' });
});

// Since 5cff76b65: the sidebar's first row is Plugins (everything installed
// and connected), and Plugin Forge is a toolbar tab beside PLUGINS, like
// every other forge, never a sidebar row.
test('Plugins leads its sidebar, Plugin Forge is a toolbar tab, and sidebar rows switch the section @ci', async ({ appPage: page }) => {
  await studio(page, '/connectors');
  const sidebar = page.locator('.connectors-panel');
  await expect(sidebar.locator('.nav-item').first()).toHaveAttribute('data-nav', 'apps');
  await expect(sidebar.locator('[data-nav="apps"]')).toContainText('Plugins');
  await expect(sidebar.locator('[data-nav="apps"]')).toHaveClass(/active/);
  expect(await sidebar.locator('.nav-item').filter({ hasText: /forge/i }).count()).toBe(0);
  const tabs = page.locator('.cv-nav-panels .cv-pbtn');
  await expect(tabs.first()).toBeVisible();
  expect((await tabs.allTextContents()).map((label) => label.trim())).toEqual(['PLUGINS', 'PLUGIN FORGE']);
  await sidebar.locator('[data-nav="mcp-servers"]').click();
  await expect(sidebar.locator('[data-nav="mcp-servers"]')).toHaveClass(/active/);
  await expect(sidebar.locator('[data-nav="apps"]')).not.toHaveClass(/active/);
});
