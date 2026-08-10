/**
 * TWO TABS, ONE RUN. The cross-client run-visibility contract, made executable.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A chat run outlives the socket that started it, and any of a user's clients
 * may attach to it: at boot via GET /orchestrator/runs, or live via the
 * `run:started` announcement. Every layer of that has unit tests — 3,600 of
 * them — and they all passed while the feature had a defect that made it look
 * broken to a human: the attach was logged from a promise that settles only
 * when the RUN ENDS, so attaching to a ten-minute task printed nothing for ten
 * minutes. The attach worked. It was silent. Nothing that mocks a store or
 * asserts on source can see that, because nothing there has a clock and a
 * console and a second tab.
 *
 * So this suite runs the real thing: two real tabs in one real browser, two
 * real Socket.IO connections, a real fan-out, and a real SSE reattach off the
 * real replay log.
 *
 * THE ONE SUBSTITUTION: the chat turn itself. See fixtures/crossClientBackend.mjs
 * for exactly what is stood in for, and which committed test covers the part
 * that is. Everything downstream of the wire is real here.
 *
 * WHY THE TABS MUST SHARE A CONTEXT
 * ---------------------------------
 * One browser context is one browser: the tabs share localStorage. That is what
 * makes the central assertion meaningful — "same browser" does NOT mean "same
 * client", because the client id is per PAGE LOAD, held in module memory. Had
 * it been persisted to sessionStorage (which looked tempting while building
 * this), the second tab would recognise the first tab's run as its own and sit
 * blind. Nothing else in the suite would notice.
 */
import { test, expect } from '@playwright/test';
import {
  portsForWorker,
  assertSafePorts,
  startHarnessBackend,
  startHarnessVite,
  openTab,
} from './fixtures/crossClientHarness.js';

// SERIAL: every test shares the servers and the browser context built in
// beforeAll, and the later ones assert on runs the earlier ones started. Serial
// also means a broken harness reports one failure rather than four.
//
// RETRIES ON CI, AND WHAT A RETRY MUST NOT BE TAKEN TO MEAN. This suite
// orchestrates two servers, three tabs and a websocket on a shared runner, so
// some flake is genuinely infrastructural (a slow cold start, a bind that loses
// a race). One retry absorbs that. It does NOT absorb product flake: Playwright
// reports a test that passed on retry as `flaky`, distinctly from `passed`, and
// a flaky result HERE deserves investigation rather than a shrug — the races
// this file exists to catch would present in exactly that way. `trace:
// 'on-first-retry'` in playwright.config.js means the evidence is already saved.
test.describe.configure({ mode: 'serial', retries: process.env.CI ? 1 : 0 });

// THE @ci TAG IS THE CI CONTRACT, AND IT IS DELIBERATELY NOT A FILENAME.
//
// The CI job selects work with `--grep @ci` rather than by listing this file,
// so a future headless suite is gated by tagging itself — not by someone
// remembering to edit a workflow. Selecting by path would silently leave the
// next one ungated, which is the same failure the root vitest config warns
// about: dropping a suite quietly is as bad as ignoring one.
//
// To earn the tag a suite must need NOTHING beyond what the CI job already
// provides: `npm ci`, `npm rebuild sqlite3`, the frontend deps, a built
// frontend/dist, and `npx playwright install chromium`. Concretely that rules
// out an Electron binary, a branded Chrome channel, the network, and API keys.
//
// (`frontend/dist` joined that list when the UI specs — app, navigation,
// agents, chat, workflows — were ported off Electron and tagged: they drive
// the real app, which backend/server.js serves from dist.)
const CI_TAG = { tag: '@ci' };

// Cold-starting a backend that runs the full database bootstrap, plus Vite, is
// well past the config's 60s default on a cold CI runner.
const SETUP_TIMEOUT = 240000;
const TEST_TIMEOUT = 120000;

/** Text published by the harness backend BEFORE any client attaches. */
const REPLAYED_TEXT = 'Starting the long job';

let backend;
let vite;
let context;
let tab1;
let tab2;
let firstConversationId;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(SETUP_TIMEOUT);

  const ports = portsForWorker(testInfo.workerIndex);
  assertSafePorts(ports);

  backend = await startHarnessBackend(ports.backend);
  vite = await startHarnessVite(ports.vite, ports.backend);

  // ONE context = one browser = shared localStorage. Two pages in it are two
  // TABS, which is the distinction this whole suite turns on.
  context = await browser.newContext();
  await context.addInitScript((t) => { localStorage.setItem('token', t); }, backend.token);

  tab1 = await openTab(context, vite.url);
  tab2 = await openTab(context, vite.url);
});

test.afterAll(async () => {
  await context?.close().catch(() => {});
  await vite?.stop().catch(() => {});
  backend?.stop();
});

test('the harness talks to its own backend, never a real install', CI_TAG, async () => {
  // The single most consequential fact about this suite. frontend/user.config.js
  // sends a page served on :5173 to http://localhost:3333 — a developer's real
  // AGNT, with their real database. This asserts the URL the page ACTUALLY
  // resolved, not merely that the port constant is right.
  expect(tab1.baseUrl).not.toContain('3333');
  expect(tab1.baseUrl).toContain(String(new URL(vite.url).port));
});

test('two tabs in one browser are two different clients', CI_TAG, async () => {
  test.setTimeout(TEST_TIMEOUT);

  expect(tab1.clientId).toBeTruthy();
  expect(tab2.clientId).toBeTruthy();
  // The load-bearing assertion. Same browser, same localStorage, different
  // identity — because the id lives in module memory, per page load.
  expect(tab2.clientId).not.toBe(tab1.clientId);

  // ...and the storage really is shared, so the distinction above is not an
  // accident of isolation.
  expect(await tab2.page.evaluate(() => localStorage.getItem('token'))).toBe(backend.token);
});

test('a second tab attaches to a run started in the first', CI_TAG, async () => {
  test.setTimeout(TEST_TIMEOUT);

  firstConversationId = `conv-xclient-${Date.now()}`;
  const started = await tab1.startRun(firstConversationId);

  // The server can only label the announcement if the request identified its
  // sender — the header chatService.streamChat sends on every turn.
  expect(started.originClientId).toBe(tab1.clientId);

  // Tab 2 was already open and idle. Nothing polls; nothing reloaded. The only
  // thing that can tell it is the announcement.
  //
  // Polled on the REPLAYED TEXT rather than on the conversation existing: the
  // slot appears the instant reattachConversation commits ENSURE_CONVERSATION,
  // which is one HTTP round trip before any replayed event lands. Waiting on
  // `known` therefore reads a half-attached conversation as success and then
  // fails on the next line — a self-inflicted flake, and one this suite caught
  // on its first run.
  await expect.poll(async () => (await tab2.snapshot(firstConversationId)).text, {
    timeout: 30000,
    message: `tab 2 never received the replay. Console:\n${tab2.logs.join('\n')}`,
  }).toContain(REPLAYED_TEXT);

  const snap = await tab2.snapshot(firstConversationId);

  // THE assertion that separates a real reattach from the old delta mirror:
  // this text was published BEFORE tab 2 attached, so holding it proves tab 2
  // received the REPLAY, not merely the notification. A test that only checked
  // "tab 2 logged something" would pass on a broken reattach.
  expect(snap.text).toContain(REPLAYED_TEXT);
  expect(snap.isStreaming).toBe(true);

  // And it said so AT THE ATTACH — the defect that prompted this file. The
  // suffix names the surface, which is the difference between "a run was
  // adopted" and "a run was adopted BY THE RIGHT SURFACE".
  expect(tab2.logs.join('\n')).toContain(`Attaching to run announced elsewhere: ${firstConversationId} → main chat`);
});

test('the originating tab ignores its own announcement', CI_TAG, async () => {
  test.setTimeout(TEST_TIMEOUT);

  // An assertion of an ABSENCE, which is only meaningful beside the previous
  // test: if the handler were simply dead, this would pass and mean nothing.
  const snap = await tab1.snapshot(firstConversationId);
  expect(snap.known).toBe(false);
  expect(snap.allConversationIds).not.toContain(firstConversationId);
  expect(tab1.logs.join('\n')).not.toContain('Attaching to run announced elsewhere');
});

test('a tab opened mid-run discovers it with no announcement at all', CI_TAG, async () => {
  test.setTimeout(TEST_TIMEOUT);

  // Tab 3 boots into a run that is already in flight, so it missed the
  // announcement entirely. GET /orchestrator/runs is the only thing that can
  // find it — and before that endpoint existed, nothing could.
  const tab3 = await openTab(context, vite.url);

  await expect.poll(async () => (await tab3.snapshot(firstConversationId)).text, {
    timeout: 30000,
    message: `tab 3 never discovered the run at boot. Console:\n${tab3.logs.join('\n')}`,
  }).toContain(REPLAYED_TEXT);

  // The log names WHICH source found it. `0 local marker(s), 1 from server` is
  // the shape that matters: tab 3 wrote no marker of its own, so the server
  // list is demonstrably what did the work.
  expect(tab3.logs.join('\n')).toMatch(/\[runResume\].*from server/);

  await tab3.page.close();
});

test('the broadcast audience counts tabs, not browsers', CI_TAG, async () => {
  test.setTimeout(TEST_TIMEOUT);

  // Two tabs remain open (tab 3 closed above). The count is read from the real
  // broadcastToUser log line, so this is the product's own bookkeeping — which
  // makes it a genuine diagnostic: a wrong count here means a dead socket, and
  // knowing that immediately is worth more than the assertion itself.
  await expect.poll(() => backend.lines('Broadcasting run:started').length, { timeout: 15000 })
    .toBeGreaterThan(0);

  const twoTabRun = backend.lines('(2 clients)');
  expect(twoTabRun.length, `broadcast lines:\n${backend.lines('Broadcasting run:started').join('\n')}`)
    .toBeGreaterThan(0);

  // Open a third tab and the audience must grow.
  const extra = await openTab(context, vite.url);
  await tab1.startRun(`conv-xclient-three-${Date.now()}`);
  await expect.poll(() => backend.lines('(3 clients)').length, {
    timeout: 20000,
    message: `audience never reached 3:\n${backend.lines('Broadcasting run:started').join('\n')}`,
  }).toBeGreaterThan(0);

  // Close it and the audience must shrink — proving the count is live rather
  // than a high-water mark, and therefore that it cannot mask a dead socket.
  await extra.page.close();
  const before = backend.lines('(2 clients)').length;
  await expect.poll(async () => {
    await tab1.startRun(`conv-xclient-shrink-${Date.now()}`);
    return backend.lines('(2 clients)').length;
  }, {
    timeout: 20000,
    message: `audience never shrank back:\n${backend.lines('Broadcasting run:started').join('\n')}`,
  }).toBeGreaterThan(before);
});
