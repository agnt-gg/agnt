import { test, expect } from './fixtures/appFixture.js';
const json = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const catalog = [
  { id: 'a1', title: 'Research assistant', tagline: 'A second pair of eyes.', description: 'Read, compare and summarize your research.', asset_type: 'agent', publisher_pseudonym: 'AGNT', downloads: 50, price: 0 },
  { id: 'w1', title: 'Weekly report', description: 'Your week, brought together.', asset_type: 'workflow', publisher_pseudonym: 'AGNT', downloads: 20, price: 9.5 },
  { id: 't1', title: 'Quick search', tagline: 'Find the answer.', asset_type: 'tool', downloads: 10, price: 0 },
];
async function prepare(page) {
  await page.addInitScript(() => {
    localStorage.setItem('uiMode', 'focused');
    localStorage.setItem('tours_auto_start', 'false');
    localStorage.setItem('agnt:focused-intro-seen', 'true');
  });
  await page.route('**/users/preferences**', route => route.fulfill(json({})));
  await page.route('**/users/settings', route => route.fulfill(json({ selectedProvider: 'OpenAI', selectedModel: 'gpt-4o' })));
  await page.route('**/marketplace/items**', route => route.fulfill(json({ items: catalog })));
  await page.route('**/marketplace/my-installs', route => route.fulfill(json({ installs: [] })));
}
async function withStore(page, fn, value) {
  return page.evaluate(([source, input]) => new Function('store', 'input', source)(document.querySelector('#app').__vue_app__.config.globalProperties.$store, input), [fn, value]);
}

for (const width of [1920, 1440, 900, 390]) {
  test(`Focused exact message/composer edges and contrast at ${width}px @ci`, async ({ appPage: page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await prepare(page);
    await page.goto('/chat');
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
    await withStore(page, 'return store.dispatch("theme/setUiMode", "focused")');
    await withStore(page, `
      store.commit('chat/ENSURE_CONVERSATION', 'layout-contract');
      store.commit('chat/SCOPED_SET_MESSAGES', { conversationId: 'layout-contract', messages: [
        { id: 'layout-user', role: 'user', content: 'My message must be readable in light mode.', timestamp: 1 },
        { id: 'layout-reply', role: 'assistant', content: 'A response that must stay inside the input column. '.repeat(70), timestamp: 2 }
      ] });
      store.commit('chat/SET_ACTIVE_CONVERSATION', 'layout-contract');
    `);
    await expect(page.locator('[data-message-id="layout-reply"]')).toBeAttached();
    // Wait for the message-appear transform to settle before measuring boxes.
    await page.waitForTimeout(600);
    for (const closed of [false, true]) {
      if (width > 800) {
        const button = page.getByRole('button', { name: closed ? 'Close sidebar' : 'Open sidebar', exact: true });
        if (await button.isVisible()) await button.click();
      }
      const geometry = await page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
        return { transcript: rect('.conversation-container'), reply: rect('[data-message-id="layout-reply"]'), replyContent: rect('[data-message-id="layout-reply"] .message-content'), composer: rect('.input-container'), input: rect('.input-line') };
      });
      await testInfo.attach(`geometry-${closed ? 'closed' : 'open'}`, { body: JSON.stringify(geometry), contentType: 'application/json' });
      console.log(`[focused geometry ${width}px sidebar-${closed ? 'closed' : 'open'}] ${JSON.stringify(geometry)}`);
      for (const selector of ['reply', 'replyContent', 'composer', 'input']) {
        for (const edge of ['left', 'right', 'width']) expect(Math.abs(geometry.transcript[edge] - geometry[selector][edge]), `${selector} ${edge}`).toBe(0);
      }
    }
    for (const theme of ['light', 'rose', 'dark', 'cyberpunk', 'midnight', 'ember', 'nord', 'hacker']) {
      await withStore(page, 'return store.dispatch("theme/setTheme", input)', theme);
      const colors = await page.locator('[data-message-id="layout-user"]').evaluate(el => {
        const text = getComputedStyle(el.querySelector('.message-text')).color;
        const background = getComputedStyle(el.querySelector('.message-card')).backgroundColor;
        // Alpha backgrounds composite over the actual canvas.
        const canvas = getComputedStyle(document.querySelector('.ui-focused')).backgroundColor;
        const rgb = css => css.match(/[\d.]+/g).map(Number);
        const blend = (front, back) => front.slice(0, 3).map((c, i) => c * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
        const luminance = values => values.slice(0, 3).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
        const bg = luminance(blend(rgb(background), rgb(canvas))), fg = luminance(rgb(text));
        return { text, background, ratio: (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05) };
      });
      await testInfo.attach(`contrast-${theme}`, { body: JSON.stringify(colors), contentType: 'application/json' });
      expect(colors.ratio, `${theme} user-message contrast`).toBeGreaterThanOrEqual(4.5);
      console.log(`[focused contrast ${width}px ${theme}] ${colors.ratio.toFixed(2)}:1`);
    }
  });
}

for (const width of [1440, 900, 390]) {
  test(`Focused one-line home prompt and bounded Recents at ${width}px @ci`, async ({ appPage: page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await prepare(page);
    await page.route(/\/api\/content-outputs(\?.*)?$/, route => route.request().method() === 'GET' ? route.fulfill(json({ outputs: [{ id: 'long-title', title: 'A deliberately long conversation title that must never escape its selected row or overlay the unread indicator'.repeat(3), content_type: 'conversation', updated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }], totalCount: 1 })) : route.fallback());
    await page.goto('/chat');
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
    await withStore(page, 'return store.dispatch("theme/setUiMode", "focused")');
    const heading = page.locator('.focused-home-hero h1');
    await expect(heading).toBeVisible();
    const line = await heading.evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const rects = [...range.getClientRects()];
      return { tops: [...new Set(rects.map(r => Math.round(r.top)))], width: el.getBoundingClientRect().width, parentWidth: el.parentElement.getBoundingClientRect().width };
    });
    expect(line.tops).toHaveLength(1);
    expect(line.width).toBeLessThanOrEqual(line.parentWidth);
    if (width <= 800) await page.getByRole('button', { name: 'Open sidebar', exact: true }).click();
    const recent = page.locator('.focused-recent').first();
    await expect(recent).toBeVisible();
    // Selected, unread and working states must all preserve the same bounds.
    const bounds = await recent.evaluate(el => {
      const result = [];
      for (const classes of ['active', 'unread', 'working active']) {
        el.className = `focused-recent ${classes}`;
        const title = el.querySelector('.focused-recent-title'), row = el.getBoundingClientRect(), r = title.getBoundingClientRect();
        result.push({ classes, rowLeft: row.left, rowRight: row.right, titleLeft: r.left, titleRight: r.right, clipped: title.scrollWidth > title.clientWidth, overflow: getComputedStyle(title).textOverflow });
      }
      return result;
    });
    for (const row of bounds) {
      expect(row.titleLeft).toBeGreaterThan(row.rowLeft);
      expect(row.titleRight).toBeLessThan(row.rowRight);
      expect(row.clipped).toBe(true);
      expect(row.overflow).toBe('ellipsis');
    }
    await page.screenshot({ path: testInfo.outputPath('home-and-sidebar.png') });
  });
}

for (const width of [1440, 390]) {
  test(`Focused native storefront, search and deep links at ${width}px @ci`, async ({ appPage: page }, testInfo) => {
    await page.setViewportSize({ width, height: 950 });
    await prepare(page);
    await page.goto('/marketplace');
    await page.waitForFunction(() => document.querySelector('#app')?.__vue_app__?.config.globalProperties.$store?.getters.criticalDataReady);
    await withStore(page, 'return store.dispatch("theme/setUiMode", "focused")');
    await withStore(page, 'return store.dispatch("theme/setTheme", "light")');
    await expect(page.locator('.focused-market')).toBeVisible();
    await expect(page.locator('.focused-market-card')).toHaveCount(3);
    await expect(page.locator('.focused-borrowed-bar')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('market-light.png'), fullPage: true });
    expect(await page.locator('.focused-market').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole('searchbox', { name: 'Search Market' }).fill('Weekly');
    await expect(page.locator('.focused-market-card')).toHaveCount(1);
    await page.locator('.focused-market-card-open').click();
    await expect(page).toHaveURL(/item=w1/);
    await expect(page.locator('.focused-market-detail h2')).toHaveText('Weekly report');
    await page.getByRole('button', { name: 'Reviews & more details' }).click();
    await expect(page).toHaveURL(/item=w1.*studio=1/);
    await expect(page.locator('.focused-borrowed-bar')).toBeVisible();
  });
}
