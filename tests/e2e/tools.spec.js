/**
 * The tools library lists real tools, grouped, and its search filters them.
 *
 * WHY THIS WAS REWRITTEN
 * ──────────────────────
 * The original asserted `getByText('Tools')` was visible after clicking the
 * thing labelled "Tools" — satisfied by the sidebar button itself. Measured
 * across four routes, the string is on every screen:
 *
 *     text=Tools   /chat 2   /settings 3   /tools 15   /agents 3
 *
 * It could not go red. The original knew its own check was weak and left a
 * commented-out search-input assertion with the note "this might fail, but
 * it's a reasonable guess" — the input does exist, so the guess was right,
 * but a guess that is never run is not a test.
 *
 * Markers below were verified screen-specific before being used:
 *
 *     .tool-header      /chat 0   /settings 0   /tools 51   /agents 0
 *     .category-header  /chat 0   /settings 0   /tools 6    /agents 0
 *
 * NOTE .wm-search-input is deliberately NOT used as the sole proof of arrival:
 * it also renders on /agents (a shared library-chrome component), so on its
 * own it would not distinguish this screen. It is used only as the mechanism
 * for the filtering assertion, after .tool-header has established where we are.
 *
 * COUNTS ARE RELATIVE, NEVER ABSOLUTE. There are 51 built-in tools today and
 * that number changes whenever one is added; asserting it would produce a test
 * that fails for the one reason nobody wants — someone did their job.
 *
 * TOOLS.VUE HAS TWO INDEPENDENT SEARCH IMPLEMENTATIONS, and this suite only
 * exercises one. `toolsByCategory` filters the CARD view (the default, and
 * what these assertions drive); `filteredTools` filters the TABLE view
 * (currentLayout === 'table'). They are separate computeds with different
 * field lists — the card one also matches on `category`. Found by mutation:
 * disabling the search in `filteredTools` left this suite entirely green.
 * So if search ever looks broken, check WHICH layout, and know that fixing one
 * computed does not fix the other.
 */
import { test, expect, gotoApp } from './fixtures/appFixture.js';

test.describe('Tools', () => {
  test('lists tools grouped into categories @ci', async ({ appPage }) => {
    await gotoApp(appPage, '/');
    await appPage.locator('[data-tour-id="sidebar.tools"]').click();
    await appPage.waitForURL('**/tools');

    // The library actually loaded tools from the backend, and grouped them.
    // Both are screen-specific; neither exists on any other screen.
    await expect(appPage.locator('.tool-header').first()).toBeVisible();
    expect(await appPage.locator('.tool-header').count()).toBeGreaterThan(0);
    expect(await appPage.locator('.category-header').count()).toBeGreaterThan(0);

    // A known built-in, so this fails if the list renders empty shells.
    await expect(appPage.locator('.tool-header').filter({ hasText: 'Browser Agent' })).toHaveCount(1);
  });

  test('search filters the library @ci', async ({ appPage }) => {
    await gotoApp(appPage, '/tools');
    await expect(appPage.locator('.tool-header').first()).toBeVisible();

    const total = await appPage.locator('.tool-header').count();
    const search = appPage.locator('.wm-search-input');

    // Behavioural, not presence: an input that is rendered but wired to
    // nothing is exactly the failure a visibility check cannot see.
    await search.fill('browser');
    await expect(appPage.locator('.tool-header')).toHaveCount(1);
    await expect(appPage.locator('.tool-header').first()).toContainText('Browser Agent');

    // A term that matches nothing must empty the list — proving the filter is
    // really filtering rather than the search being a no-op that left the
    // full list standing.
    await search.fill('zzzz-no-such-tool');
    await expect(appPage.locator('.tool-header')).toHaveCount(0);

    // Clearing restores everything, so the filter is not one-way.
    await search.fill('');
    await expect(appPage.locator('.tool-header')).toHaveCount(total);
  });
});
