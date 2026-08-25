/**
 * THE TRUST BOUNDARY, IN A REAL BROWSER, AGAINST THE SHIPPED BUNDLE.
 *
 * WHY THIS EXISTS ALONGSIDE THE UNIT SPECS
 * ────────────────────────────────────────
 * `oauthMessageOrigin.spec.js` calls the trust predicate directly with
 * hand-built event objects. That proves the predicate is correct. It does NOT
 * prove the predicate is REACHED — a handler that
 * forgets to call it, or calls it after reading the payload, passes every one
 * of those tests.
 *
 * jsdom also cannot produce the thing being defended against. There is no real
 * cross-origin document, no real `postMessage` plumbing, and `event.source` is
 * whatever the test author wrote down. The defect these fixes close was
 * specifically about which senders can reach a live window, so the test that
 * settles it needs live windows.
 *
 * So this spec sends REAL messages from REAL frames at the REAL bundle, and
 * asserts on the OBSERVABLE CONSEQUENCE rather than on a return value:
 *
 *   - a redeemed OAuth code is an HTTP request. If none is made, nothing was
 *     redeemed. That is the whole impact of the Connectors.vue defect.
 *   - an accepted sign-in token is written to localStorage. If it is not
 *     there, no session was grafted.
 *
 * A test that asserted "the predicate returned false" would be testing the
 * predicate again. These assert that the ATTACK produced nothing.
 */
import { test, expect, gotoApp } from './fixtures/appFixture.js';

/**
 * Serve an attacker page on an origin that is NOT the app's.
 *
 * `page.route` fulfils the request without a network hop, so no real DNS or
 * listener is needed, but the browser still treats the document as genuinely
 * cross-origin — which is the only thing that matters here.
 */
const EVIL_ORIGIN = 'https://localhost.evil.com';

/**
 * The exact origin shape the old guard admitted.
 *
 * The replaced code was:
 *   allowedOrigins.some((o) => event.origin === o || event.origin.includes('localhost'))
 *
 * whose second term ignores its own parameter, making it an unconditional
 * substring test. `https://localhost.evil.com` contains "localhost" and is
 * registrable by anyone, so it passed. The repo's pre-existing negative test
 * used `https://evil.example.com`, which contains no "localhost" and was
 * refused by the broken guard too — which is exactly why the hole survived
 * having coverage.
 */
/**
 * Serve an attacker page that posts at the app until told to stop.
 *
 * A single shot could be posted before the handler is registered and produce a
 * false pass, so it repeats.
 */
async function routeAttackerFrame(page, body) {
  await page.route(`${EVIL_ORIGIN}/**`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body });
  });
}

function mountAttackerFrame(page) {
  return page.evaluate((origin) => {
    const frame = document.createElement('iframe');
    frame.src = `${origin}/attacker.html`;
    frame.style.cssText = 'width:1px;height:1px;opacity:0';
    document.body.appendChild(frame);
  }, EVIL_ORIGIN);
}

/**
 * Collect refusal diagnostics off the page console.
 *
 * These are what prove DELIVERY. Asserting "no redemption happened" is
 * worthless if the message never arrived, and a fixed `waitForTimeout` cannot
 * tell those apart — it just hopes the machine was fast enough. Under ten
 * parallel workers it is not, which is how the first version of this spec
 * failed in a full run while passing in isolation.
 */
function collectRefusals(page) {
  const refusals = [];
  page.on('console', (m) => {
    if (m.text().includes('[oauth] refused a message from')) refusals.push(m.text());
  });
  return refusals;
}

test.describe('an OAuth code is not redeemed for an untrusted sender', () => {
  test('a cross-origin frame whose host merely CONTAINS "localhost" is refused @ci', async ({
    appPage: page,
  }) => {
    // Every attempt to redeem a code is this request. Count them.
    const redemptions = [];
    await page.route('**/auth/callback*', async (route) => {
      redemptions.push(route.request().url());
      await route.fulfill({ status: 200, body: '{"success":false}' });
    });

    const refusals = collectRefusals(page);

    await routeAttackerFrame(
      page,
      `<!doctype html><meta charset="utf-8"><title>attacker</title>
       <script>
         setInterval(() => {
           parent.postMessage(
             { type: 'oauth-callback', code: 'ATTACKER_CODE', state: 'x', provider: 'google' },
             '*',
           );
           parent.postMessage({ type: 'oauth_success', provider: 'google' }, '*');
         }, 50);
       </script>`,
    );

    await gotoApp(page, '/');
    await mountAttackerFrame(page);

    // Wait for PROOF OF DELIVERY rather than for the clock. This is also what
    // makes the assertion below non-vacuous: the handler demonstrably ran and
    // refused, so an empty `redemptions` means refused-and-not-redeemed and
    // not merely never-arrived.
    await expect
      .poll(() => refusals.length, {
        timeout: 30000,
        message:
          'No refusal was ever logged, so the hostile messages never reached a '
          + 'handler. The assertion below would have passed vacuously.',
      })
      .toBeGreaterThan(0);

    expect(refusals[0]).toContain('localhost.evil.com');
    expect(
      redemptions,
      'The app redeemed an attacker-supplied OAuth code against the signed-in '
        + `user's account. Requests observed:\n${redemptions.join('\n')}`,
    ).toEqual([]);
  });

  test('the refusal is reported once per origin, not once per message @ci', async ({
    appPage: page,
  }) => {
    // The diagnostic sits on a path an attacker can drive at will, so it has to
    // be bounded or it becomes its own denial of service.
    const refusals = collectRefusals(page);

    await routeAttackerFrame(
      page,
      `<!doctype html><meta charset="utf-8">
       <script>
         setInterval(() => {
           parent.postMessage({ type: 'oauth-callback', code: 'C', state: 'S' }, '*');
         }, 25);
       </script>`,
    );

    await gotoApp(page, '/');
    await mountAttackerFrame(page);

    await expect.poll(() => refusals.length, { timeout: 30000 }).toBeGreaterThan(0);

    // At 25ms, an unbounded reporter would produce dozens more in this window.
    // One is the only count consistent with per-origin suppression.
    await page.waitForTimeout(1500);
    expect(
      refusals.length,
      'The diagnostic logged once per MESSAGE rather than once per ORIGIN.',
    ).toBe(1);
  });
});
