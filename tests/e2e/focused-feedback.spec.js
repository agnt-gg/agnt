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
      // One's frame is painted with the theme's own background: the shell, and on a desktop the rail
      // drawn clear over it, so rail and page read as one surface (One replaced Focused's sidebar).
      const colors = await page.evaluate(() => {
        const shell = document.querySelector('.ui-one');
        const background = document.createElement('span'); background.style.background = 'var(--color-background)'; shell.append(background);
        const rail = document.querySelector('.mk-rail-host');
        const result = { shell: getComputedStyle(shell).backgroundColor, rail: rail ? getComputedStyle(rail).backgroundColor : null, background: getComputedStyle(background).backgroundColor };
        background.remove(); return result;
      });
      expect(colors.shell, theme).toBe(colors.background);
      if (width > 800) expect([colors.background, 'rgba(0, 0, 0, 0)'], `${theme} rail`).toContain(colors.rail);
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

// AGNT One gives every page one lead action: an ink pill, the colour of the text, like the composer's
// send button (one.css "Buttons: one language on every page"). It used to copy Studio's green outline;
// One replaced that deliberately. What must hold in every theme: it IS the ink pill, and it is readable.
test('One New buttons are the readable ink pill in every theme @ci', async ({ appPage: page }) => {
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); });
  // Widgets is a library page whose Studio toolbar carries the New button.
  await page.goto('/widget-manager');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
  const store = (fn, arg) => page.evaluate(([body, value]) => new Function('store', 'value', body)(document.querySelector('#app').__vue_app__.config.globalProperties.$store, value), [fn, arg]);
  await store('return store.dispatch("theme/setUiMode", value)', 'focused');
  for (const theme of ['cyberpunk', 'dark', 'light', 'rose', 'midnight', 'ember', 'nord', 'hacker']) {
    await store('return store.dispatch("theme/setTheme", value)', theme);
    await page.locator('.ui-one .focused-primary').first().waitFor();
    const button = await page.locator('.ui-one .focused-primary').first().evaluate(el => {
      const ink = document.createElement('span'); ink.style.color = 'var(--text-primary)'; el.parentElement.append(ink);
      const c = getComputedStyle(el), expected = getComputedStyle(ink).color; ink.remove();
      const rgb = css => css.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = v => v.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((s, x, i) => s + x * [.2126, .7152, .0722][i], 0);
      const a = lum(rgb(c.color)), b = lum(rgb(c.backgroundColor));
      return { background: c.backgroundColor, ink: expected, radius: parseFloat(c.borderTopLeftRadius), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
    expect(button.background, `${theme} fill`).toBe(button.ink);
    expect(button.radius, `${theme} pill`).toBeGreaterThanOrEqual(16);
    expect(button.ratio, `${theme} label contrast`).toBeGreaterThanOrEqual(4.5);
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

// On a desktop One has no account menu: Log out is in Settings (the rail's gear). On a phone it is
// also in the chats drawer's account menu. Both must end the session.
for (const width of [1440, 390]) test(`One log out ends the session and lands on sign-in at ${width}px @ci`, async ({ appPage: page }) => {
  await page.setViewportSize({ width, height: 950 });
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); });
  await page.goto('/chat');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('theme/setUiMode', 'focused'));
  if (width > 800) {
    await page.getByTestId('one-rail-settings').click();
    await page.locator('.ui-one').getByRole('button', { name: 'Log out', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Open chats', exact: true }).click();
    await page.locator('.focused-account').click();
    await page.getByTestId('focused-logout').click();
  }
  await expect.poll(() => page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.getters['userAuth/isAuthenticated'])).toBe(false);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('token'))).toBeNull();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByRole('button', { name: /sign in|log in|continue/i }).first()).toBeVisible();
});


// Reported: a running chat in Focused's Recents looked exactly like an unread
// one. It must pulse and say who is speaking, then fall back to unread when done.
// In One those Recents are the phone's chats drawer (FocusedSidebar); a desktop
// shows Studio's chat list, covered by the test after this one.
test('One phone Recents show a running chat as working, with who is speaking @ci', async ({ appPage: page }) => {
  await page.setViewportSize({ width: 390, height: 950 });
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
  await page.getByRole('button', { name: 'Open chats', exact: true }).click();
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

// The same promise on a desktop, where One shows Studio's own chat list
// (OneShell one-chat-sidebar -> OutputList): a running chat shows the
// streaming mark instead of the unread dot and says who is speaking.
test('One desktop chat list shows a running chat as working, with who is speaking @ci', async ({ appPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); localStorage.setItem('uiMode', 'focused'); });
  await page.route('**/users/preferences**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const now = new Date(), earlier = new Date(now.getTime() - 60000);
  const row = { id: 'out-live', title: 'Background research', content_type: 'conversation', updated_at: now.toISOString(), created_at: earlier.toISOString(), last_read_at: earlier.toISOString() };
  await page.route(/\/api\/content-outputs(\?.*)?$/, r => r.request().method() === 'GET'
    ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ outputs: [row], totalCount: 1 }) })
    : r.fallback());
  await page.goto('/chat');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
  const item = page.locator('[data-testid="one-chat-sidebar"] .output-item', { hasText: 'Background research' });
  await expect(item.locator('.unread-dot')).toBeVisible();

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
  await expect(item).toHaveClass(/streaming/);
  await expect(item.locator('.streaming-indicator')).toBeVisible();
  await expect(item.locator('.unread-dot')).toHaveCount(0);
  await expect(item).toContainText('Sol speaking');

  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.commit('chat/SCOPED_SET_STREAMING', { conversationId: 'conv-live', value: false }));
  await expect(item).not.toHaveClass(/streaming/);
  await expect(item).not.toContainText('speaking');
  await expect(item.locator('.unread-dot')).toBeVisible();
});
