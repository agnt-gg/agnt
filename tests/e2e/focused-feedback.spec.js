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

// AGNT One gives every page one lead action. Since v2 (542c6577f) it is the brand button, filled with
// the theme's pink (mk-v2.css), in place of the earlier ink pill. What must hold in every theme: it IS
// that button, and its label is readable.
test('One New buttons are the readable brand button in every theme @ci', async ({ appPage: page }) => {
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); });
  // One's pages load the account's teams first; this account has none.
  await page.route('**/teams', route => route.fulfill(json([])));
  // Widgets is a Library page whose header carries the New button.
  await page.goto('/widget-manager');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
  const store = (fn, arg) => page.evaluate(([body, value]) => new Function('store', 'value', body)(document.querySelector('#app').__vue_app__.config.globalProperties.$store, value), [fn, arg]);
  await store('return store.dispatch("theme/setUiMode", value)', 'focused');
  for (const theme of ['cyberpunk', 'dark', 'light', 'rose', 'midnight', 'ember', 'nord', 'hacker']) {
    await store('return store.dispatch("theme/setTheme", value)', theme);
    await page.locator('.ui-one .page-head .primary').first().waitFor();
    const button = await page.locator('.ui-one .page-head .primary').first().evaluate(el => {
      const brand = document.createElement('span'); brand.style.background = 'var(--color-pink)'; el.parentElement.append(brand);
      const c = getComputedStyle(el), expected = getComputedStyle(brand).backgroundColor; brand.remove();
      const rgb = css => css.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = v => v.map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((s, x, i) => s + x * [.2126, .7152, .0722][i], 0);
      const a = lum(rgb(c.color)), b = lum(rgb(c.backgroundColor));
      return { background: c.backgroundColor, brand: expected, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
    expect(button.background, `${theme} fill`).toBe(button.brand);
    expect(button.ratio, `${theme} label contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

test('Focused shows a custom agent image exactly as Studio resolves it @ci', async ({ appPage: page }) => {
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.addInitScript(() => { localStorage.setItem('tours_auto_start', 'false'); localStorage.setItem('agnt:focused-intro-seen', 'true'); });
  // One's pages load the account's teams first; this account has none.
  await page.route('**/teams', route => route.fulfill(json([])));
  // Through the real fetch path: the backend stores the picture as `icon`.
  await page.route('**/api/agents/', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ agents: [{ id: 'pic-agent', name: 'Picture Agent', icon: pixel, status: 'ACTIVE' }] }) }));
  await page.goto('/agents');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
  await page.evaluate(() => document.querySelector('#app').__vue_app__.config.globalProperties.$store.dispatch('theme/setUiMode', 'focused'));
  // /agents is the Library's Agents tab: the agent's card shows its picture in place of the initial.
  const image = page.locator('.ui-one .cards .card', { hasText: 'Picture Agent' }).locator('img.v2-pic');
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

// The same promise on a desktop, where One's sidebar lists the chats with
// Studio's own list (MkDrawer one-chat-sidebar -> OutputList): a running chat
// shows the streaming mark instead of the unread dot and says who is speaking.
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

// As in Focused's Recents, every title in One's sidebar starts at the same left
// edge, under the icon above it: the Main chat's pin (New chat is a centred
// button since 6e0733ad4). Read, unread or running, a row's state is a
// mark at the right end of its title line, never an indent; in Groups, a
// group's chats sit flush under its header, with no indent (2632af4a).
test('One desktop chat list lines every title up on the left, whatever its state @ci', async ({ appPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.addInitScript(() => {
    localStorage.setItem('tours_auto_start', 'false');
    localStorage.setItem('agnt:focused-intro-seen', 'true');
    localStorage.setItem('uiMode', 'focused');
    localStorage.setItem('agnt:savedChats:view', 'all');
  });
  await page.route('**/users/preferences**', r => r.fulfill(json({})));
  const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
  const rows = [
    { id: 'out-read', title: 'Weekly competitor report', group_id: 'grp-north', updated_at: ago(30), last_read_at: ago(25) },
    { id: 'out-unread', title: 'Northwind renewal email', group_id: 'grp-north', updated_at: ago(10), last_read_at: ago(20) },
    { id: 'out-live', title: 'Background research', group_id: null, updated_at: ago(20), last_read_at: ago(15) },
  ].map(row => ({ content_type: 'conversation', created_at: ago(60), ...row }));
  await page.route(/\/api\/content-outputs(\?.*)?$/, r => r.request().method() === 'GET'
    ? r.fulfill(json({ outputs: rows, totalCount: rows.length }))
    : r.fallback());
  await page.route(/\/api\/groups(\?.*)?$/, r => r.request().method() === 'GET'
    ? r.fulfill(json({ groups: [{ id: 'grp-north', name: 'Northwind', parent_id: null }] }))
    : r.fallback());
  await page.goto('/chat');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
  const list = page.locator('[data-testid="one-chat-sidebar"]');
  await expect(list.locator('.output-item')).toHaveCount(3);
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
  await expect(list.locator('.output-item', { hasText: 'Background research' }).locator('.streaming-indicator')).toBeVisible();
  await expect(list.locator('.output-item', { hasText: 'Northwind renewal email' }).locator('.unread-dot')).toBeVisible();

  const measure = () => page.evaluate(() => {
    // Where an element's text starts on screen: its first non-blank character.
    const textLeft = (el) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const start = node.textContent.search(/\S/);
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, node.textContent.length);
        return range.getBoundingClientRect().left;
      }
      return null;
    };
    const sidebar = document.querySelector('[data-testid="one-sidebar"]');
    return {
      navIconLeft: sidebar.querySelector('[data-testid="main-chat-row"] .main-mark').getBoundingClientRect().left,
      rows: [...sidebar.querySelectorAll('[data-testid="one-chat-sidebar"] .output-item')].map((row) => {
        const mark = row.querySelector('.unread-dot, .streaming-indicator');
        const groupMark = row.closest('.group-section')?.querySelector('.group-header-left > :first-child');
        return {
          title: row.querySelector('.output-preview').textContent.trim(),
          titleLeft: textLeft(row.querySelector('.output-preview')),
          metaLeft: row.querySelector('.output-meta')?.getBoundingClientRect().left ?? null,
          rowRight: row.getBoundingClientRect().right,
          markLeft: mark ? mark.getBoundingClientRect().left : null,
          groupMarkLeft: groupMark ? groupMark.getBoundingClientRect().left : null,
        };
      }),
    };
  });

  const flat = await measure();
  expect(flat.rows.map(r => r.title).sort()).toEqual(['Background research', 'Northwind renewal email', 'Weekly competitor report']);
  for (const row of flat.rows) {
    expect(Math.abs(row.titleLeft - flat.navIconLeft), `${row.title}: starts under the icons above`).toBeLessThanOrEqual(1);
    expect(row.metaLeft, `${row.title}: has its meta line`).not.toBeNull();
    expect(Math.abs(row.metaLeft - row.titleLeft), `${row.title}: meta line under the title`).toBeLessThanOrEqual(1);
  }
  const marked = flat.rows.filter(r => r.markLeft !== null);
  expect(marked.map(r => r.title).sort()).toEqual(['Background research', 'Northwind renewal email']);
  for (const row of marked) expect(row.markLeft, `${row.title}: its mark is at the right end`).toBeGreaterThan(row.rowRight - 30);

  await list.locator('.view-seg-btn', { hasText: 'Groups' }).click();
  await list.locator('.group-header', { hasText: 'Northwind' }).click();
  await expect(list.locator('.output-item')).toHaveCount(3);
  const grouped = await measure();
  for (const row of grouped.rows) {
    expect(row.groupMarkLeft, `${row.title}: sits in a group`).not.toBeNull();
    expect(Math.abs(row.titleLeft - grouped.navIconLeft), `${row.title}: no group indent, the same left edge as every title`).toBeLessThanOrEqual(1);
  }
});

// A chat's ⋯ menu (Rename, Archive, Move to group, Delete) and a group's menu
// open beside the row; from the lowest rows they used to run off the bottom of
// the window. They stay inside it, 8px clear, even after Move to group grows.
test('One desktop chat list keeps its row and group menus inside the window @ci', async ({ appPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.addInitScript(() => {
    localStorage.setItem('tours_auto_start', 'false');
    localStorage.setItem('agnt:focused-intro-seen', 'true');
    localStorage.setItem('uiMode', 'focused');
    localStorage.setItem('agnt:savedChats:view', 'all');
  });
  await page.route('**/users/preferences**', r => r.fulfill(json({})));
  const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
  const groups = [
    { id: 'grp-a', name: 'Northwind', parent_id: null },
    { id: 'grp-b', name: 'Launch week', parent_id: null },
    { id: 'grp-c', name: 'Research', parent_id: null },
  ];
  const rows = Array.from({ length: 14 }, (_, i) => ({
    id: `out-${i}`, title: `Saved chat ${i + 1}`, content_type: 'conversation',
    group_id: i < 10 ? groups[i % 3].id : null,
    updated_at: ago(10 + i * 60), created_at: ago(20 + i * 60), last_read_at: ago(10 + i * 60),
  }));
  await page.route(/\/api\/content-outputs(\?.*)?$/, r => r.request().method() === 'GET'
    ? r.fulfill(json({ outputs: rows, totalCount: rows.length }))
    : r.fallback());
  await page.route(/\/api\/groups(\?.*)?$/, r => r.request().method() === 'GET'
    ? r.fulfill(json({ groups }))
    : r.fallback());
  await page.goto('/chat');
  await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
  const list = page.locator('[data-testid="one-chat-sidebar"]');
  await expect(list.locator('.output-item')).toHaveCount(14);

  // How far the open menu reaches past the window's 8px margin, on any side.
  // Under 1px is rounding: the clamp moves it by whole pixels, rows sit at fractions.
  const menuOverflow = () => page.evaluate(() => {
    const menu = document.querySelector('.action-menu');
    if (!menu) return 'no menu';
    const r = menu.getBoundingClientRect();
    return Math.max(0, 8 - r.top, r.bottom - (innerHeight - 8), 8 - r.left, r.right - (innerWidth - 8));
  });

  // The lowest chat fully in view, just above the sidebar's Collapse row.
  const lowest = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="one-sidebar"] .drawer-scroll').getBoundingClientRect();
    const inView = [...document.querySelectorAll('[data-testid="one-chat-sidebar"] .output-item')]
      .filter((row) => { const r = row.getBoundingClientRect(); return r.top >= scroller.top && r.bottom <= scroller.bottom; });
    const last = inView[inView.length - 1];
    return { title: last.querySelector('.output-preview').textContent.trim(), bottom: last.getBoundingClientRect().bottom };
  });
  expect(lowest.bottom, 'the row is in the bottom fifth of the window').toBeGreaterThan(700 * 0.8);
  const row = list.locator('.output-item', { hasText: lowest.title });
  await row.hover();
  await row.locator('.action-menu-btn').click();
  await expect(page.locator('.action-menu')).toBeVisible();
  await expect.poll(menuOverflow, { message: `${lowest.title}: its menu stays inside the window` }).toBeLessThan(1);
  // Still beside the button it came from.
  const beside = await page.evaluate((title) => {
    const button = [...document.querySelectorAll('[data-testid="one-chat-sidebar"] .output-item')]
      .find((el) => el.querySelector('.output-preview').textContent.trim() === title)
      .querySelector('.action-menu-btn').getBoundingClientRect();
    return document.querySelector('.action-menu').getBoundingClientRect().left - button.right;
  }, lowest.title);
  expect(beside, 'opens to the right of its button').toBeGreaterThanOrEqual(0);

  // Move to group lists every group inside the menu: it grows and still fits.
  await page.locator('.action-menu .menu-item', { hasText: 'Move to group' }).click();
  await expect(page.locator('.action-menu .submenu-inline')).toBeVisible();
  await expect.poll(menuOverflow, { message: 'with Move to group open' }).toBeLessThan(1);
  await page.mouse.click(1100, 350);
  await expect(page.locator('.action-menu')).toHaveCount(0);

  // A group's menu opens at the pointer: right-click a group header at the bottom of the list.
  await list.locator('.view-seg-btn', { hasText: 'Groups' }).click();
  for (const name of ['Northwind', 'Launch week']) await list.locator('.group-header', { hasText: name }).click();
  const header = list.locator('.group-header', { hasText: 'Research' });
  await header.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  const headerBox = await header.boundingBox();
  expect(headerBox.y + headerBox.height, 'the header is in the bottom fifth of the window').toBeGreaterThan(700 * 0.8);
  await header.click({ button: 'right' });
  await expect(page.locator('.action-menu')).toBeVisible();
  await expect.poll(menuOverflow, { message: 'the group menu stays inside the window' }).toBeLessThan(1);
});
