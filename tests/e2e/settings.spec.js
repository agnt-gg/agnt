/**
 * The settings screen renders the signed-in account, and its sections switch.
 *
 * WHY THIS WAS REWRITTEN
 * ──────────────────────
 * The original asserted `getByText('Settings')` was visible after clicking the
 * thing labelled "Settings" — which is true whenever the click does nothing at
 * all, because the sidebar button itself satisfies it. Measured across four
 * routes, that string is present on EVERY screen:
 *
 *     text=Settings   /chat 1   /settings 3   /tools 2   /agents 1
 *
 * So the check could not go red, and a ✓ next to it meant nothing. (The
 * original's own commented-out alternative was no better — it guessed at
 * "Provider" text with a comment saying "This assumes ... Using a broad match
 * to be safe".)
 *
 * The two assertions below were chosen by asking the running app what this
 * screen actually owns, and then verifying those markers are absent from
 * /chat, /tools and /agents:
 *
 *     .profile-header   /chat 0   /settings 1   /tools 0   /agents 0
 *     .user-name        /chat 0   /settings 1   /tools 0   /agents 0
 *
 * 1. IDENTITY. The profile renders the signed-in user's own name and email.
 *    This fails if the screen does not load, AND if it loads but the user data
 *    never arrives — which is the failure the whole auth fixture exists to
 *    prevent, and which used to render "Sign in to AGNT" instead.
 *
 * 2. SECTION SWITCHING. Behavioural rather than presence-based: settings is a
 *    master/detail screen, and a detail pane that never changes is the
 *    interesting way for it to be broken. Presence alone cannot see that.
 */
import { test, expect, gotoApp } from './fixtures/appFixture.js';
import { mockUser } from './fixtures/auth.js';

test.describe('Settings', () => {
  test('shows the signed-in account @ci', async ({ appPage }) => {
    await gotoApp(appPage, '/');
    await appPage.locator('[data-tour-id="sidebar.settings"]').click();
    await appPage.waitForURL('**/settings');

    // Screen-specific: this container exists on no other screen.
    const profile = appPage.locator('.profile-header');
    await expect(profile).toBeVisible();

    // The identity itself. 'TestUser' is the pseudonym the fixture serves from
    // /referrals/user/**, so this also proves that call was made and rendered
    // rather than silently swallowed.
    await expect(profile.locator('.user-name')).toHaveText('TestUser');
    await expect(profile).toContainText(mockUser.email);
  });

  test('switches between settings sections @ci', async ({ appPage }) => {
    await gotoApp(appPage, '/settings');

    const title = appPage.locator('.content-title').first();
    await expect(title).toHaveText('User Profile');

    // A different section must actually replace the detail pane.
    await appPage.getByText('Theme', { exact: true }).first().click();
    await expect(title).toHaveText('Theme Settings');
    // ...and the profile must be genuinely gone, not merely covered.
    await expect(appPage.locator('.profile-header')).toHaveCount(0);

    // And back, so this cannot pass on a screen that only ever moves forward.
    await appPage.getByText('Profile', { exact: true }).first().click();
    await expect(title).toHaveText('User Profile');
    await expect(appPage.locator('.profile-header')).toBeVisible();
  });
});
