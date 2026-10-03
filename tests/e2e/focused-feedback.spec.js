import { test, expect } from './fixtures/appFixture.js';
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
for (const width of [1440, 900, 390]) {
  test(`Focused theme and chat column parity at ${width}px @ci`, async ({ appPage: page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await page.addInitScript(() => {
      localStorage.setItem('agnt:ui-mode', 'focused');
      localStorage.setItem('uiMode', 'focused');
      localStorage.setItem('tours_auto_start', 'false');
    });
    await page.route('**/users/settings', route => route.fulfill(json({ selectedProvider: 'OpenAI', selectedModel: 'gpt-4o' })));
    await page.goto('/chat');
    await page.waitForFunction(() => !!document.querySelector('#app')?.__vue_app__);
    await page.evaluate(async () => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
      await store.dispatch('theme/setUiMode', 'focused');
      const id = 'focus-layout';
      store.commit('chat/ENSURE_CONVERSATION', id);
      store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: id, messages: [
        { id: 'focus-user', role: 'user', content: 'Please check the layout.', timestamp: 1 },
        { id: 'focus-reply', role: 'assistant', content: 'This reply should align exactly with the input.', timestamp: 2 },
      ] });
      store.commit('chat/SET_ACTIVE_CONVERSATION', id);
    });
    await expect(page.locator('.ui-focused .input-container')).toBeVisible();
    await expect(page.locator('[data-message-id="focus-reply"]')).toBeVisible();
    const geometry = await page.evaluate(() => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
      return { transcript: rect('.conversation-container'), composer: rect('.ui-focused.is-compact .input-line, .ui-focused:not(.is-compact) .input-container'), input: rect('.input-line') };
    });
    await testInfo.attach('geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
    for (const edge of ['left', 'right', 'width']) expect(Math.abs(geometry.transcript[edge] - geometry.composer[edge]), edge).toBeLessThanOrEqual(1);
    if (width > 800) for (const edge of ['left', 'right', 'width']) expect(Math.abs(geometry.transcript[edge] - geometry.input[edge]), `visible input ${edge}`).toBeLessThanOrEqual(1);
    for (const theme of ['cyberpunk', 'dark', 'light', 'rose', 'midnight', 'ember', 'nord', 'hacker']) {
      await page.evaluate(async theme => {
        const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
        await store.dispatch('theme/setTheme', theme);
      }, theme);
      // The sidebar is painted with the theme's own background, like Studio's rail.
      const colors = await page.evaluate(() => {
        const shell = document.querySelector('.ui-focused');
        const background = document.createElement('span'); background.style.background = 'var(--color-background)'; shell.append(background);
        const result = { sidebar: getComputedStyle(document.querySelector('.focused-sidebar')).backgroundColor, background: getComputedStyle(background).backgroundColor };
        background.remove(); return result;
      });
      expect(colors.sidebar, theme).toBe(colors.background);
    }
    // A different conversation gets a different TransitionGroup: outgoing
    // welcome/setup nodes cannot remain while the incoming one renders.
    await page.evaluate(() => {
      const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
      store.commit('chat/ENSURE_CONVERSATION', 'focus-new');
      store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: 'focus-new', messages: [{ id: 'focus-new-welcome', role: 'assistant', content: 'Welcome', timestamp: 3 }] });
      store.commit('chat/SET_ACTIVE_CONVERSATION', 'focus-new');
    });
    await expect(page.locator('[data-message-id="focus-new-welcome"]')).toBeAttached();
    expect(await page.locator('[data-message-id="focus-reply"]').count()).toBe(0);
  });
}

// Studio is the reference: Focused's New button must compute to exactly what
// Studio's New button computes to, theme by theme — not to a token we chose.
test('Focused New buttons match Studio New buttons in every theme @ci', async ({ appPage: page }) => {
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); });
  // Widgets is a library page whose Studio toolbar carries the New button.
  await page.goto('/widget-manager');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
  const store = (fn, arg) => page.evaluate(([body, value]) => new Function('store', 'value', body)(document.querySelector('#app').__vue_app__.config.globalProperties.$store, value), [fn, arg]);
  const paint = selector => page.locator(selector).first().evaluate(el => { const c = getComputedStyle(el); return { color: c.color, background: c.backgroundColor, border: c.borderTopColor }; });
  for (const theme of ['cyberpunk', 'dark', 'light', 'rose', 'midnight', 'ember', 'nord', 'hacker']) {
    await store('return store.dispatch("theme/setTheme", value)', theme);
    await store('return store.dispatch("theme/setUiMode", value)', 'studio');
    await page.locator('.wm-btn-create').first().waitFor();
    const studio = await paint('.wm-btn-create');
    await store('return store.dispatch("theme/setUiMode", value)', 'focused');
    await page.locator('.ui-focused .focused-primary').first().waitFor();
    const focused = await paint('.ui-focused .focused-primary');
    expect(focused, theme).toEqual(studio);
  }
});

test('Focused shows a custom agent image exactly as Studio resolves it @ci', async ({ appPage: page }) => {
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); });
  // Through the real fetch path: the backend stores the picture as `icon`.
  await page.route('**/api/agents/', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [{ id: 'pic-agent', name: 'Picture Agent', icon: pixel, status: 'ACTIVE' }] }) }));
  await page.goto('/agents');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('theme/setUiMode', 'focused'));
  const image = page.locator('.focused-row', { hasText: 'Picture Agent' }).locator('.focused-row-icon img');
  await expect(image).toHaveAttribute('src', pixel);
  await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
});

test('Focused log out ends the session and lands on sign-in @ci', async ({ appPage: page }) => {
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); });
  await page.goto('/chat');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('theme/setUiMode', 'focused'));
  await page.locator('.focused-account').click();
  await page.getByTestId('focused-logout').click();
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters['userAuth/isAuthenticated'])).toBe(false);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByRole('button', { name: /sign in|log in|continue/i }).first()).toBeVisible();
});


// Reported: a running chat in Focused's Recents looked exactly like an unread
// one. It must pulse and say who is speaking, then fall back to unread when done.
test('Focused Recents shows a running chat as working, with who is speaking @ci', async ({ appPage: page }) => {
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); localStorage.setItem('uiMode', 'focused'); });
  await page.route('**/users/preferences**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  // The chat list, served by the backend, with the conversation unread
  // (activity after its read watermark). The page's own reloads keep it.
  const now = new Date(), earlier = new Date(now.getTime() - 60000);
  const row = { id: 'out-live', title: 'Background research', content_type: 'conversation', updated_at: now.toISOString(), created_at: earlier.toISOString(), last_read_at: earlier.toISOString() };
  await page.route(/\/api\/content-outputs(\?.*)?$/, r => r.request().method() === 'GET'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outputs: [row], totalCount: 1 }) })
    : r.fallback());
  await page.goto('/chat');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
  const recent = page.locator('.focused-recent', { hasText: 'Background research' });
  await expect(recent).toHaveClass(/unread/);

  // A run starts in that conversation, as a stream would set it.
  await page.evaluate(() => {
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$store;
    store.commit('chat/ENSURE_CONVERSATION', 'conv-live');
    store.commit('chat/SCOPED_SET_SAVED_OUTPUT_ID', { conversationId: 'conv-live', id: 'out-live' });
    store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: 'conv-live', messages: [
      { id: 'u', role: 'user', content: 'research this' },
      { id: 'a', role: 'assistant', content: '', agentId: 'agent-sol', agentName: 'Sol' },
    ] });
    store.commit('chat/SCOPED_SET_STREAMING', { conversationId: 'conv-live', value: true });
  });
  await expect(recent).toHaveClass(/working/);
  await expect(recent).not.toHaveClass(/unread/);
  await expect(recent).toHaveAttribute('aria-busy', 'true');
  await expect(recent.locator('.focused-working-dot')).toBeVisible();
  await expect(recent.locator('.focused-recent-status')).toHaveText('Sol speaking');
  expect(await recent.locator('.focused-working-dot').evaluate(el => getComputedStyle(el).animationName)).toBe('ui-focused-working-pulse');

  // The run ends: the pulse goes, and the unread dot comes back.
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('chat/SCOPED_SET_STREAMING', { conversationId: 'conv-live', value: false }));
  await expect(recent).not.toHaveClass(/working/);
  await expect(recent.locator('.focused-recent-status')).toHaveCount(0);
  await expect(recent).toHaveClass(/unread/);
});
