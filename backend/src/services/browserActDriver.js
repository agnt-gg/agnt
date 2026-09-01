/**
 * Deterministic browser verbs over CDP — how the fast browser agents work.
 *
 * ---------------------------------------------------------------------------
 * WHY VERBS, NOT A NESTED AGENT AND NOT GENERATED CODE
 * ---------------------------------------------------------------------------
 * Every fast browser agent shipping today — Grok's bot, ChatGPT's Atlas/agent,
 * OpenClaw, Playwright MCP, Vercel's agent-browser — converged on the same
 * design, and it is none of the things we were doing:
 *
 *   - THE CALLING AGENT IS THE LOOP. No second model. The agent calls
 *     snapshot -> click(@e2) -> type(@e5) as ordinary tool calls, and the
 *     reasoning happens in the model that is already running. ai-browser-use's
 *     nested agent pays a whole second model and hides the page from the outer
 *     one; ai-browser-control removes the nested model but makes the agent
 *     write Python blind, with a venv + daemon spawn + preflight per step.
 *
 *   - THE AGENT SEES AN ACCESSIBILITY TREE, NOT PIXELS. A page as
 *     `@e2 button "Sign In"` is 2-5KB of text with stable handles to act on.
 *     A screenshot of the same page is a vision-model round trip that returns
 *     coordinates, which go stale on the next reflow.
 *
 *   - ACTIONS ARE MILLISECONDS OF CDP. Every verb here is one or two protocol
 *     commands against a browser that is already open.
 *
 * Everything session-scoped, which matters more than it looks: the Electron
 * widget's CdpBridge forwards session-scoped commands verbatim, so the same
 * verbs drive the Browser widget on the canvas AND a launched headless browser
 * without a branch anywhere.
 *
 * ---------------------------------------------------------------------------
 * REFS ARE A CONTRACT WITH AN EXPIRY
 * ---------------------------------------------------------------------------
 * A snapshot assigns @e1..@eN to interactive nodes and remembers their CDP
 * backendDOMNodeIds. Those ids belong to the DOCUMENT, not the URL bar: they
 * die on navigation. Acting on a ref is therefore guarded by "is this still
 * the page the snapshot described?" — and the failure is an instruction to
 * re-snapshot, not a silent click on whatever now occupies that node id.
 */

import { CdpConnection, attachToPage } from './cdpConnection.js';

/**
 * userId -> live driver session.
 *
 * One per user, not per call: the connection, the page session and the ref map
 * are the agent's working memory between tool calls. Rebuilding them per verb
 * would work, but "snapshot then click" is the core loop and the click must see
 * the refs the snapshot minted.
 */
const drivers = new Map();

/** Forget a user's driver; the next verb reconnects from scratch. */
export function dropDriver(userId) {
  const driver = drivers.get(userId);
  if (!driver) return;
  drivers.delete(userId);
  try { driver.connection.close(); } catch { /* already gone */ }
}

/** Test seam, and the shutdown path. */
export function _resetDrivers() {
  for (const userId of [...drivers.keys()]) dropDriver(userId);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function driverFor(userId, cdpUrl) {
  const existing = drivers.get(userId);
  if (existing && existing.cdpUrl === cdpUrl && !existing.connection.closed) return existing;
  dropDriver(userId);

  const connection = await new CdpConnection(cdpUrl).connect();
  const { sessionId } = await attachToPage(connection);
  const driver = {
    userId, cdpUrl, connection, sessionId, refs: new Map(), refUrl: null, axEnabled: false,
  };
  connection.onEvent((message) => {
    if (message.method === '__closed') drivers.delete(userId);
  });
  drivers.set(userId, driver);

  await connection.send('Page.enable', {}, sessionId);
  await connection.send('DOM.enable', {}, sessionId);
  // Some backends refuse backendNodeId lookups until a document has been
  // fetched at least once. Cheap, and only on (re)connect.
  await connection.send('DOM.getDocument', { depth: 0 }, sessionId).catch(() => {});
  return driver;
}

async function evaluate(driver, expression) {
  const res = await driver.connection.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  }, driver.sessionId);
  if (res?.exceptionDetails) {
    throw new Error(res.exceptionDetails.exception?.description || 'the page threw while reading state');
  }
  return res?.result?.value;
}

/** Where the page is right now — returned by every verb so the agent never guesses. */
async function pageState(driver) {
  const raw = await evaluate(driver, 'JSON.stringify({ url: location.href, title: document.title })')
    .catch(() => null);
  try { return JSON.parse(raw); } catch { return { url: null, title: null }; }
}

/**
 * Wait for a navigation to settle, by polling rather than by event.
 *
 * The initial pause is load-bearing: for the first moments after Page.navigate
 * returns, `document.readyState` still answers for the page being LEFT, and an
 * immediate poll declares victory against the wrong document.
 *
 * A page that never finishes is not a failed action — plenty of real pages
 * load forever. The caller gets whatever exists at the deadline and can
 * snapshot it.
 */
async function waitForLoad(driver, timeoutMs = 12000) {
  await sleep(300);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- this IS the polling loop.
    const state = await evaluate(driver, 'document.readyState').catch(() => null);
    if (state === 'complete' || state === 'interactive') return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(250);
  }
}

// ─── snapshot ───────────────────────────────────────────────────────────────

/**
 * Roles an agent can act on. Everything here gets a @ref.
 *
 * Headings are included WITHOUT refs for orientation — a page of bare buttons
 * with no landmarks reads like a ransom note.
 */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
  'switch', 'slider', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'listbox', 'spinbutton',
]);

/** State worth showing beside a ref. */
const NOTED_PROPS = new Set(['focused', 'disabled', 'checked', 'expanded', 'required', 'selected']);

function describeProps(node) {
  const notes = [];
  for (const prop of node.properties || []) {
    if (NOTED_PROPS.has(prop.name) && prop.value?.value) notes.push(prop.name);
  }
  return notes.length ? ` [${notes.join(', ')}]` : '';
}

async function takeSnapshot(driver, { query = '', maxChars = 8000 } = {}) {
  if (!driver.axEnabled) {
    await driver.connection.send('Accessibility.enable', {}, driver.sessionId).catch(() => {});
    driver.axEnabled = true;
  }
  const state = await pageState(driver);
  const { nodes = [] } = await driver.connection.send('Accessibility.getFullAXTree', {}, driver.sessionId);

  driver.refs.clear();
  driver.refUrl = state.url;

  const q = String(query || '').trim().toLowerCase();
  const lines = [`URL: ${state.url}`, `Title: ${state.title}`, ''];
  let total = lines.join('\n').length;
  let counter = 0;
  let truncated = false;

  for (const node of nodes) {
    if (node.ignored) continue;
    const role = node.role?.value || '';
    const name = (node.name?.value || '').trim();
    const interactive = INTERACTIVE_ROLES.has(role) && node.backendDOMNodeId;

    // Unqueried: interactive elements plus named headings for orientation.
    // Queried: ANY named node that matches, because "find the text that says X"
    // is half of what queries are for.
    const include = q
      ? Boolean(name) && (name.toLowerCase().includes(q) || role.toLowerCase().includes(q))
      : (interactive || (role === 'heading' && Boolean(name)));
    if (!include) continue;

    let line;
    if (interactive) {
      counter += 1;
      const ref = `e${counter}`;
      driver.refs.set(ref, node.backendDOMNodeId);
      const value = node.value?.value ? ` value="${String(node.value.value).slice(0, 80)}"` : '';
      line = `@${ref} ${role} "${name.slice(0, 120)}"${value}${describeProps(node)}`;
    } else {
      line = `${role} "${name.slice(0, 160)}"`;
    }

    total += line.length + 1;
    if (total > maxChars) { truncated = true; break; }
    lines.push(line);
  }

  if (truncated) lines.push(`… (truncated at ${maxChars} chars — pass query to narrow it)`);
  if (counter === 0 && !q) lines.push('(no interactive elements found — the page may still be loading; try again or read its text)');

  return { ...state, snapshot: lines.join('\n') };
}

// ─── acting on refs ─────────────────────────────────────────────────────────

/**
 * Resolve what a click or type should act on: a @ref or a CSS selector.
 *
 * WHY BOTH EXIST. Refs come from snapshots, and snapshots are read by a model
 * — they are the right handle for an agent reasoning about a page it just
 * looked at. A workflow authored once and run forever has no model in the
 * loop and no snapshot to spend; it needs an address that survives page
 * loads. That is a CSS selector. Selector resolution is LIVE (queried against
 * the document as it is right now), so it deliberately skips the staleness
 * guard — there is no snapshot to be stale against.
 */
async function resolveActionTarget(driver, { ref, selector } = {}) {
  const css = String(selector || '').trim();
  if (css) {
    const { root } = await driver.connection.send('DOM.getDocument', { depth: 0 }, driver.sessionId);
    const found = await driver.connection.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: css,
    }, driver.sessionId);
    if (!found?.nodeId) {
      throw new Error(`Nothing on the page matches the selector "${css}".`);
    }
    const { node } = await driver.connection.send('DOM.describeNode', { nodeId: found.nodeId }, driver.sessionId);
    if (!node?.backendNodeId) {
      throw new Error(`The element matching "${css}" cannot be acted on.`);
    }
    return node.backendNodeId;
  }

  await assertFreshRefs(driver);
  return refTarget(driver, ref);
}

function refTarget(driver, ref) {
  const clean = String(ref || '').replace(/^@/, '').trim();
  const backendNodeId = driver.refs.get(clean);
  if (!backendNodeId) {
    throw new Error(
      `No element @${clean} in the current snapshot. Refs only come from action="snapshot", `
      + 'and they reset when the page changes — take a snapshot first.',
    );
  }
  return backendNodeId;
}

/**
 * Refuse to act on refs from a page that is no longer there.
 *
 * backendDOMNodeIds belong to the document. After a navigation the same number
 * either dangles or names a different element — and a click that lands on
 * "whatever is there now" is the kind of wrong that looks like it worked.
 */
async function assertFreshRefs(driver) {
  const state = await pageState(driver);
  if (driver.refUrl && state.url !== driver.refUrl) {
    driver.refs.clear();
    throw new Error(
      `The page has navigated since that snapshot (now on ${state.url}). `
      + 'Take a new snapshot — those refs belong to the old page.',
    );
  }
  return state;
}

async function clickRef(driver, { ref, selector } = {}) {
  const backendNodeId = await resolveActionTarget(driver, { ref, selector });

  // Off-screen elements have a box but receive no synthetic mouse events.
  await driver.connection.send('DOM.scrollIntoViewIfNeeded', { backendNodeId }, driver.sessionId)
    .catch(() => { /* older Chromium; the box may already be visible */ });

  const { model } = await driver.connection.send('DOM.getBoxModel', { backendNodeId }, driver.sessionId);
  const quad = model.content;
  const x = Math.round((quad[0] + quad[2] + quad[4] + quad[6]) / 4);
  const y = Math.round((quad[1] + quad[3] + quad[5] + quad[7]) / 4);

  const base = { x, y, button: 'left', clickCount: 1 };
  await driver.connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base }, driver.sessionId);
  await driver.connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base }, driver.sessionId);

  // If the click starts a navigation, give it a beat so the returned URL is the
  // page the agent is now on, not the one it just left.
  await sleep(300);
  return pageState(driver);
}

async function typeIntoRef(driver, { ref, selector, text, submit = false } = {}) {
  const backendNodeId = await resolveActionTarget(driver, { ref, selector });

  await driver.connection.send('DOM.focus', { backendNodeId }, driver.sessionId);
  // Replace, don't append: selecting existing content first means insertText
  // overwrites it, which is what "type X into the box" means to a person.
  await evaluate(driver, 'document.execCommand("selectAll")').catch(() => {});
  await driver.connection.send('Input.insertText', { text: String(text ?? '') }, driver.sessionId);

  if (submit) return pressKey(driver, 'Enter');
  return pageState(driver);
}

const KEYS = {
  Enter: { vk: 13, text: '\r' },
  Tab: { vk: 9 },
  Escape: { vk: 27 },
  Backspace: { vk: 8 },
  Delete: { vk: 46 },
  ArrowUp: { vk: 38 },
  ArrowDown: { vk: 40 },
  ArrowLeft: { vk: 37 },
  ArrowRight: { vk: 39 },
  PageUp: { vk: 33 },
  PageDown: { vk: 34 },
  Home: { vk: 36 },
  End: { vk: 35 },
};

async function pressKey(driver, key) {
  const spec = KEYS[key];
  if (!spec) throw new Error(`Unsupported key "${key}". One of: ${Object.keys(KEYS).join(', ')}`);

  const base = {
    key, code: key, windowsVirtualKeyCode: spec.vk, nativeVirtualKeyCode: spec.vk,
  };
  // Enter carries text so forms submit; for the rest rawKeyDown is the honest
  // event (there is no character).
  await driver.connection.send('Input.dispatchKeyEvent', {
    type: spec.text ? 'keyDown' : 'rawKeyDown',
    ...base,
    ...(spec.text ? { text: spec.text, unmodifiedText: spec.text } : {}),
  }, driver.sessionId);
  await driver.connection.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, driver.sessionId);

  await sleep(300);
  return pageState(driver);
}

async function scrollPage(driver, deltaY) {
  const dims = await evaluate(driver, 'JSON.stringify({ w: innerWidth, h: innerHeight })').catch(() => null);
  const { w = 1280, h = 800 } = (() => { try { return JSON.parse(dims); } catch { return {}; } })() || {};
  await driver.connection.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: Math.round(w / 2),
    y: Math.round(h / 2),
    deltaX: 0,
    // Positive scrolls DOWN, matching WheelEvent and puppeteer's mouse.wheel.
    deltaY: Number(deltaY) || 600,
  }, driver.sessionId);
  await sleep(150);
  return pageState(driver);
}

async function readPageText(driver, selector, maxChars = 6000) {
  const expression = selector
    ? `(document.querySelector(${JSON.stringify(selector)})?.innerText) ?? '(nothing matches that selector)'`
    : 'document.body.innerText';
  const text = String(await evaluate(driver, expression) ?? '');
  const state = await pageState(driver);
  return {
    ...state,
    text: text.length > maxChars
      ? `${text.slice(0, maxChars)}\n… (truncated at ${maxChars} chars — pass selector or maxChars)`
      : text,
  };
}

async function navigateTo(driver, url) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target) && !/^about:|^data:/i.test(target)) {
    // A bare domain is what agents type. Meeting them there beats an error.
    return navigateTo(driver, `https://${target}`);
  }
  await driver.connection.send('Page.navigate', { url: target }, driver.sessionId);
  await waitForLoad(driver);
  driver.refs.clear();
  driver.refUrl = null;
  return pageState(driver);
}

async function goBack(driver) {
  const history = await driver.connection.send('Page.getNavigationHistory', {}, driver.sessionId);
  const { currentIndex = 0, entries = [] } = history || {};
  if (currentIndex <= 0) return { ...(await pageState(driver)), note: 'already at the start of history' };
  await driver.connection.send('Page.navigateToHistoryEntry', { entryId: entries[currentIndex - 1].id }, driver.sessionId);
  await waitForLoad(driver);
  driver.refs.clear();
  driver.refUrl = null;
  return pageState(driver);
}

// ─── the dispatcher ─────────────────────────────────────────────────────────

export const BROWSER_ACTIONS = ['navigate', 'snapshot', 'click', 'type', 'press', 'scroll', 'read', 'back'];

/**
 * Perform one verb against the user's browser.
 *
 * Transport-shaped failures drop the cached driver, so the next call
 * reconnects from scratch instead of replaying the same dead socket — the
 * lesson every other piece of this system has now learned once.
 */
export async function performBrowserAction(userId, cdpUrl, action, params = {}) {
  try {
    const driver = await driverFor(userId, cdpUrl);
    switch (action) {
      case 'navigate': return await navigateTo(driver, params.url);
      case 'snapshot': return await takeSnapshot(driver, { query: params.query, maxChars: params.maxChars });
      case 'click': return await clickRef(driver, params);
      case 'type': return await typeIntoRef(driver, {
        ref: params.ref, selector: params.selector, text: params.text, submit: Boolean(params.submit),
      });
      case 'press': return await pressKey(driver, params.key);
      case 'scroll': return await scrollPage(driver, params.deltaY);
      case 'read': return await readPageText(driver, params.selector, params.maxChars);
      case 'back': return await goBack(driver);
      default:
        throw new Error(`Unknown browser action "${action}". One of: ${BROWSER_ACTIONS.join(', ')}`);
    }
  } catch (err) {
    if (/not open|connection closed|connection errored|timed out|ECONNREFUSED|refused/i.test(err?.message || '')) {
      dropDriver(userId);
    }
    throw err;
  }
}
