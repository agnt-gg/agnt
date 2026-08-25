/**
 * A SIGN-IN POPUP MUST NOT BECOME A SECOND AGNT.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS AN E2E TEST AND NOT A UNIT TEST
 * ---------------------------------------------------------------------------
 * `oauthPopupHandoff.spec.js` proves the function is correct when called. It
 * cannot prove the function is CALLED, or that it is called EARLY ENOUGH —
 * and early enough is the entire property. The handoff has to run before
 * `adoptTokenFromUrl` strips the token from the address bar, and before
 * `createApp().mount()` renders an application into the popup. Both of those
 * are orderings inside a module that a unit test never executes.
 *
 * jsdom cannot help either: there is no real second browsing context, no real
 * `window.open`, no real opener relationship, and nothing that actually
 * mounts. So this drives a REAL popup against the REAL built bundle and
 * asserts on what the user would see.
 */
import { test, expect, gotoApp } from './fixtures/appFixture.js';
import { signTestToken } from './fixtures/auth.js';

/**
 * Shaped like a JWT — three non-empty dot-separated segments — because the
 * handoff declines anything else rather than closing the window over it. The
 * signature is meaningless and never verified here; what is under test is
 * which window ends up holding it.
 */
const HANDOFF_TOKEN = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJ1c2VySWQiOiJwb3B1cC1oYW5kb2ZmIn0',
  'c2lnbmF0dXJlLXBsYWNlaG9sZGVy',
].join('.');

test.describe('the popup hands its token back', () => {
  test('the opener receives the token and the popup closes @ci', async ({ appPage: page }) => {
    await gotoApp(page, '/');

    // The opener listens exactly the way the sign-in screen does.
    await page.evaluate(() => {
      window.__handoffToken = null;
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'google-auth-success') {
          window.__handoffToken = event.data.token;
        }
      });
    });

    const popupPromise = page.context().waitForEvent('page');
    await page.evaluate((token) => {
      window.open(`/settings?token=${token}`, 'google-login-popup', 'width=600,height=700');
    }, HANDOFF_TOKEN);

    const popup = await popupPromise;

    // Closing itself is half the fix: the user must not be left with a second
    // window to dismiss, or to keep working in by mistake.
    await popup.waitForEvent('close', { timeout: 30000 });

    await expect
      .poll(() => page.evaluate(() => window.__handoffToken), { timeout: 15000 })
      .toBe(HANDOFF_TOKEN);
  });

  test('the popup never boots an application of its own @ci', async ({ appPage: page }) => {
    // THE DEFECT, STATED AS A MEASUREMENT. A mounted AGNT issues a burst of
    // authenticated API calls on boot. If the popup mounted, they come from
    // the popup. If the handoff worked, the popup asks for nothing.
    await gotoApp(page, '/');

    const popupApiCalls = [];

    page.context().on('page', (opened) => {
      opened.on('request', (request) => {
        const url = request.url();
        if (url.includes('/api/')) popupApiCalls.push(new URL(url).pathname);
      });
    });

    const popupPromise = page.context().waitForEvent('page');
    await page.evaluate((token) => {
      window.open(`/settings?token=${token}`, 'google-login-popup', 'width=600,height=700');
    }, HANDOFF_TOKEN);

    const popup = await popupPromise;
    await popup.waitForEvent('close', { timeout: 30000 });

    // Give anything the popup started a chance to actually be sent, so this
    // does not pass merely because it looked too early.
    await page.waitForTimeout(1500);

    // `initializeApp` and the session watcher are what a booted app runs.
    // Their absence is what distinguishes "handed the token back" from "signed
    // itself in inside a 600x700 window".
    const bootCalls = popupApiCalls.filter((p) =>
      /users\/auth\/status|\/layouts|\/widget-definitions|\/agents|\/workflows|connection-health/.test(
        p,
      ),
    );

    expect(
      bootCalls,
      `The sign-in popup booted a second copy of AGNT. Calls it made:\n${popupApiCalls.join('\n')}`,
    ).toEqual([]);
  });

  test('a tab that was NOT opened by us still adopts its token @ci', async ({
    appPage: page,
  }) => {
    // THE REGRESSION GUARD. `?token=` is also how a hosted tenant hands a
    // session to a browser that navigated to it directly. That tab has no
    // opener, must not close, and must sign in normally. Breaking it would
    // lock every tenant user out.
    //
    // A REAL signed token, not the placeholder above: adopting replaces
    // whatever session the fixture established, so a token the backend refuses
    // would fail this test for a reason that has nothing to do with the popup
    // handoff.
    await gotoApp(page, `/settings?token=${signTestToken()}`);

    // Still open, and it rendered the application rather than handing its
    // token to somebody else and vanishing.
    expect(page.isClosed()).toBe(false);
    await expect(page.locator('#app')).not.toBeEmpty();

    // And it is genuinely signed in, not merely rendered: the shell only
    // appears for a session the local backend accepted.
    await expect(page.locator('[data-tour-id^="sidebar."]').first()).toBeVisible();

    // Deliberately NOT asserted here: whether `?token=` is still in the
    // address bar afterwards. Stripping it is `adoptTokenFromUrl`'s job and is
    // untouched by this change — the handoff declines this page before that
    // code runs, so both paths behave exactly as they do on main. Filed
    // separately rather than folded into an unrelated fix.
  });
});
