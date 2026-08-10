/**
 * EVERY DECLARED TOUR TARGET MUST EXIST. The registry, made executable.
 *
 * WHY THIS FILE EXISTS
 * ────────────────────
 * tourTargets.js is a promise to the assistant: it lists the elements a guided
 * tour is allowed to point at, and `targetTourId` is resolved server-side to
 * `[data-tour-id="<id>"]` and handed to PopupTutorial to highlight. Nothing
 * checked that the promise was true. It was not: of the 18 declared targets,
 * FIVE resolved to no element at all, so a tour step naming one of them
 * highlighted nothing and the user saw an explanation attached to empty space.
 *
 * sections.spec.js already holds the `sidebar.*` ids against the canvas
 * sections registry, which is the right check for list-to-list drift. It
 * cannot catch this: it compares two hand-maintained LISTS, and both were
 * perfectly consistent while the DOM had no such attribute. Only a running app
 * can answer "does this selector resolve".
 *
 * THE QUARANTINE, AND WHY IT RATCHETS
 * ───────────────────────────────────
 * Four targets are declared but not implemented, and the right element for
 * each is genuinely ambiguous — there is no "Add Node" button in the workflow
 * designer at all, and several plausible candidates for "the canvas". Guessing
 * would be worse than leaving them: a tour that highlights the WRONG element
 * actively misleads, where one that highlights nothing merely fails.
 *
 * So they are quarantined rather than fixed, and the quarantine is asserted in
 * BOTH directions: a quarantined target that starts resolving fails this test
 * too, with an instruction to delete it from the list. The list can therefore
 * only shrink — it cannot quietly become the place where broken targets go to
 * be forgotten, which is the usual fate of a skip-list.
 */
import { test, expect, gotoApp } from './fixtures/appFixture.js';
import { TOUR_TARGETS } from '../../frontend/src/views/_components/utility/tourTargets.js';

/**
 * Declared, but no element carries the id. Each needs a product decision about
 * WHICH element it means before it can be implemented — see the header.
 *
 * To remove an entry: add the data-tour-id to the element, delete the line.
 */
const NOT_IMPLEMENTED = new Set([
  'workflows.add-node-button', // no "Add Node" button exists in the designer
  'workflows.canvas',          // several candidates; which one is "the canvas"?
  'workflows.run-button',      // no Run/Activate button found on the screen
  'agents.create-button',      // no Create/New Agent button found on the screen
]);

/** Where a screen-scoped target lives. Sidebar targets (screen: null) are global. */
const SCREEN_ROUTE = {
  WorkflowsScreen: '/workflows',
  AgentsScreen: '/agents',
  DashboardScreen: '/dashboard',
};

const implemented = TOUR_TARGETS.filter((t) => !NOT_IMPLEMENTED.has(t.id));
const quarantined = TOUR_TARGETS.filter((t) => NOT_IMPLEMENTED.has(t.id));

test.describe('tour targets', () => {
  test('every implemented target resolves in the running app @ci', async ({ appPage }) => {
    test.setTimeout(180000);
    await gotoApp(appPage, '/');

    const missing = [];
    for (const target of implemented) {
      const route = SCREEN_ROUTE[target.screen];
      if (route) {
        await appPage.goto(route, { waitUntil: 'domcontentloaded' });
        // The screen mounts lazily; the sidebar is the signal that it is up.
        await appPage.waitForSelector('[data-tour-id^="sidebar."]', { timeout: 30000 });
      }
      // Polled, not counted once: a screen-scoped target may render a beat
      // after the route settles, and a flaky gate is a gate people ignore.
      const found = await appPage.locator(target.selector)
        .first().waitFor({ state: 'attached', timeout: 15000 })
        .then(() => true).catch(() => false);
      if (!found) missing.push(`${target.id} (${target.selector}) on ${target.screen || 'any screen'}`);
    }

    expect(
      missing,
      `Declared in tourTargets.js but present in no element. Either add the\n`
      + `data-tour-id to the element, or remove the entry from the registry\n`
      + `AND its backend mirror:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  test('quarantined targets are still genuinely missing @ci', async ({ appPage }) => {
    test.setTimeout(120000);
    await gotoApp(appPage, '/');

    const nowPresent = [];
    for (const target of quarantined) {
      const route = SCREEN_ROUTE[target.screen];
      if (route) {
        await appPage.goto(route, { waitUntil: 'domcontentloaded' });
        await appPage.waitForSelector('[data-tour-id^="sidebar."]', { timeout: 30000 });
      }
      if (await appPage.locator(target.selector).count() > 0) nowPresent.push(target.id);
    }

    // The ratchet. Implementing one of these is good news, and the only thing
    // that must not happen is it staying on a list of known-broken targets.
    expect(
      nowPresent,
      `These are implemented now — delete them from NOT_IMPLEMENTED in this file:\n  ${nowPresent.join('\n  ')}`,
    ).toEqual([]);
  });

  test('the frontend registry and its backend mirror agree @ci', async () => {
    // The registry header says "keep both in sync" and nothing enforced it.
    // They agree today; this is what keeps them agreeing.
    const backend = await import('../../backend/src/services/orchestrator/tutorialTargets.js');
    const backendTargets = backend.TOUR_TARGETS || backend.default?.TOUR_TARGETS || backend.default;
    const ids = (list) => list.map((t) => t.id).sort();

    expect(ids(backendTargets)).toEqual(ids(TOUR_TARGETS));
  });
});
