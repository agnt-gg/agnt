/**
 * CONTRACT for the browser verbs.
 *
 * Tested against a REAL WebSocket server speaking CDP, because every property
 * that matters here is protocol-shaped: does a snapshot mint refs that click
 * can spend, does a click land at the element's centre, does a stale ref get
 * refused rather than spent on whatever now owns that node id.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import { performBrowserAction, _resetDrivers } from './browserActDriver.js';

/**
 * A fake browser. Answers the protocol, records every Input.* dispatch, and
 * can be told to "navigate" when clicked — the shape of clicking a link.
 */
async function fakeBrowser() {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => { wss.once('listening', resolve); });

  const state = {
    url: 'https://start.example/',
    title: 'Start',
    navOnClick: null, // set to a URL to make the next click "navigate"
    inputs: [],
    connections: 0,
    axNodes: [
      { ignored: false, role: { value: 'heading' }, name: { value: 'Welcome' }, backendDOMNodeId: 11 },
      {
        ignored: false,
        role: { value: 'button' },
        name: { value: 'Sign In' },
        backendDOMNodeId: 12,
        properties: [{ name: 'focused', value: { value: true } }],
      },
      { ignored: true, role: { value: 'button' }, name: { value: 'Hidden' }, backendDOMNodeId: 13 },
      {
        ignored: false, role: { value: 'textbox' }, name: { value: 'Email' }, backendDOMNodeId: 14, value: { value: 'old@x.com' },
      },
      { ignored: false, role: { value: 'StaticText' }, name: { value: 'Paragraph about pricing tiers' }, backendDOMNodeId: 15 },
    ],
  };

  wss.on('connection', (socket) => {
    state.connections += 1;
    socket.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      const reply = (result) => socket.send(JSON.stringify({ id: m.id, result }));

      switch (m.method) {
        case 'Target.getTargets':
          return reply({ targetInfos: [{ targetId: 'T1', type: 'page' }] });
        case 'Target.attachToTarget':
          return reply({ sessionId: 'S1' });
        case 'Runtime.evaluate': {
          const expr = m.params.expression || '';
          if (expr.includes('location.href')) {
            return reply({ result: { value: JSON.stringify({ url: state.url, title: state.title }) } });
          }
          if (expr.includes('readyState')) return reply({ result: { value: 'complete' } });
          if (expr.includes('innerText')) return reply({ result: { value: 'PAGE TEXT. '.repeat(50).trim() } });
          if (expr.includes('selectAll')) return reply({ result: { value: true } });
          if (expr.includes('innerWidth')) return reply({ result: { value: JSON.stringify({ w: 1280, h: 800 }) } });
          return reply({ result: { value: null } });
        }
        case 'Page.navigate':
          state.url = m.params.url;
          state.title = 'Navigated';
          return reply({});
        case 'Accessibility.getFullAXTree':
          return reply({ nodes: state.axNodes });
        case 'DOM.getBoxModel':
          // 99 is the hidden node: Chromium refuses a box for anything with
          // no layout, and it refuses it as a protocol ERROR, not an empty
          // result — which is why the driver must catch rather than check.
          if (m.params.backendNodeId === 99) {
            return socket.send(JSON.stringify({
              id: m.id, error: { message: 'Could not compute box model.' },
            }));
          }
          return reply({ model: { content: [10, 20, 110, 20, 110, 60, 10, 60] } });
        case 'DOM.getDocument':
          return reply({ root: { nodeId: 1 } });
        case 'DOM.querySelectorAll': {
          // '#hidden-first' models the real shape that broke on agnt.gg: a
          // display:none copy earlier in the document than the visible one.
          const matches = {
            '#go': [42],
            '#hidden-first': [90, 42],
            '#all-hidden': [90],
          };
          return reply({ nodeIds: matches[m.params.selector] || [] });
        }
        case 'DOM.describeNode':
          return reply({ node: { backendNodeId: m.params.nodeId === 90 ? 99 : 12 } });
        case 'Page.getNavigationHistory':
          return reply({ currentIndex: 1, entries: [{ id: 7 }, { id: 8 }] });
        case 'Page.navigateToHistoryEntry':
          state.url = 'https://previous.example/';
          return reply({});
        default:
          if (m.method?.startsWith('Input.')) {
            state.inputs.push({ method: m.method, params: m.params });
            if (m.method === 'Input.dispatchMouseEvent' && m.params.type === 'mouseReleased' && state.navOnClick) {
              state.url = state.navOnClick;
              state.navOnClick = null;
            }
          }
          return reply({});
      }
    });
  });

  return {
    state,
    url: () => `ws://127.0.0.1:${wss.address().port}/devtools/browser/fake`,
    close: async () => {
      for (const client of wss.clients) { try { client.terminate(); } catch { /* gone */ } }
      await new Promise((resolve) => { wss.close(resolve); });
    },
  };
}

let browser;

beforeEach(async () => {
  _resetDrivers();
  browser = await fakeBrowser();
});

afterEach(async () => {
  _resetDrivers();
  await browser.close();
});

const act = (action, params = {}) => performBrowserAction('u1', browser.url(), action, params);

describe('snapshot: the page as text with spendable refs', () => {
  it('refs interactive elements, orients with headings, and drops the ignored', async () => {
    const { snapshot } = await act('snapshot');

    expect(snapshot).toContain('@e1 button "Sign In" [focused]');
    expect(snapshot).toContain('@e2 textbox "Email" value="old@x.com"');
    expect(snapshot).toContain('heading "Welcome"');
    // Ignored nodes are invisible to a person; showing them would offer refs
    // that cannot be clicked.
    expect(snapshot).not.toContain('Hidden');
    // Prose is noise in the default view — read is for prose.
    expect(snapshot).not.toContain('pricing');
    expect(snapshot).toContain('URL: https://start.example/');
  });

  it('query surfaces matching text nodes, because "find where it says X" is the point', async () => {
    const { snapshot } = await act('snapshot', { query: 'pricing' });
    expect(snapshot).toContain('Paragraph about pricing tiers');
    expect(snapshot).not.toContain('heading "Welcome"');
  });
});

describe('click: lands at the centre of the ref\'s box', () => {
  it('presses and releases at the box-model centre', async () => {
    await act('snapshot');
    await act('click', { ref: 'e1' });

    const mouse = browser.state.inputs.filter((i) => i.method === 'Input.dispatchMouseEvent');
    expect(mouse.map((m) => m.params.type)).toEqual(['mousePressed', 'mouseReleased']);
    // content quad [10,20 110,20 110,60 10,60] -> centre (60, 40)
    expect(mouse[0].params.x).toBe(60);
    expect(mouse[0].params.y).toBe(40);
  });

  it('accepts the @ spelling, because that is how snapshots print refs', async () => {
    await act('snapshot');
    const result = await act('click', { ref: '@e1' });
    expect(result.url).toBeTruthy();
  });

  it('refuses a ref that no snapshot minted, and says what to do', async () => {
    await expect(act('click', { ref: 'e99' })).rejects.toThrow(/take a snapshot/i);
  });

  it('refuses refs from a page that has been left — a stale click that "works" is worse', async () => {
    await act('snapshot');
    browser.state.navOnClick = 'https://elsewhere.example/';
    await act('click', { ref: 'e1' }); // this click navigates

    await expect(act('type', { ref: 'e2', text: 'x' })).rejects.toThrow(/new snapshot/i);
  });
});

describe('a CSS selector is the deterministic handle — no snapshot, no model, no staleness', () => {
  it('clicks by selector with no snapshot ever taken', async () => {
    // The workflow case: authored once, run forever, no model in the loop to
    // read a snapshot. The selector is resolved LIVE against the document.
    const result = await act('click', { selector: '#go' });

    const mouse = browser.state.inputs.filter((i) => i.method === 'Input.dispatchMouseEvent');
    expect(mouse.map((x) => x.params.type)).toEqual(['mousePressed', 'mouseReleased']);
    expect(mouse[0].params.x).toBe(60);
    expect(result.url).toBeTruthy();
  });

  it('types by selector', async () => {
    await act('type', { selector: '#go', text: 'from a workflow' });
    const insert = browser.state.inputs.find((i) => i.method === 'Input.insertText');
    expect(insert.params.text).toBe('from a workflow');
  });

  it('says plainly when nothing matches', async () => {
    await expect(act('click', { selector: '#nope' })).rejects.toThrow(/Nothing on the page matches/);
  });

  it('prefers a match that is LAID OUT over the first one in the document', async () => {
    // THE REGRESSION THIS PINS (found on the live site): a[href="#pricing"]
    // matched a display:none mobile-nav copy before the visible link, and the
    // click failed on a raw CDP "Could not compute box model".
    const result = await act('click', { selector: '#hidden-first' });

    const mouse = browser.state.inputs.filter((i) => i.method === 'Input.dispatchMouseEvent');
    expect(mouse.map((x) => x.params.type)).toEqual(['mousePressed', 'mouseReleased']);
    // The centre of the VISIBLE node's box, not a failure on the hidden one.
    expect(mouse[0].params.x).toBe(60);
    expect(result.url).toBeTruthy();
  });

  it('explains itself when no match is laid out at all', async () => {
    // "Could not compute box model" names an internal step and offers no
    // remedy; a person needs to know the element is hidden and what to do.
    await expect(act('click', { selector: '#all-hidden' }))
      .rejects.toThrow(/hidden, collapsed, or zero-sized/);
  });

  it('still works after a navigation — selectors cannot go stale', async () => {
    await act('snapshot');
    await act('navigate', { url: 'https://elsewhere.example/' });
    // A ref would be refused here; the selector resolves against the live page.
    const result = await act('click', { selector: '#go' });
    expect(result.url).toBeTruthy();
  });
});

describe('type: replaces, and can submit', () => {
  it('focuses the node, selects what is there, and inserts the text', async () => {
    await act('snapshot');
    await act('type', { ref: 'e2', text: 'new@x.com' });

    const insert = browser.state.inputs.find((i) => i.method === 'Input.insertText');
    expect(insert.params.text).toBe('new@x.com');
  });

  it('submit presses Enter with a carriage return, so forms actually submit', async () => {
    await act('snapshot');
    await act('type', { ref: 'e2', text: 'q', submit: true });

    const keys = browser.state.inputs.filter((i) => i.method === 'Input.dispatchKeyEvent');
    expect(keys[0].params.type).toBe('keyDown');
    expect(keys[0].params.text).toBe('\r');
    expect(keys[0].params.windowsVirtualKeyCode).toBe(13);
  });
});

describe('the other verbs', () => {
  it('press sends rawKeyDown+keyUp for characterless keys', async () => {
    await act('press', { key: 'Tab' });
    const keys = browser.state.inputs.filter((i) => i.method === 'Input.dispatchKeyEvent');
    expect(keys.map((k) => k.params.type)).toEqual(['rawKeyDown', 'keyUp']);
    expect(keys[0].params.windowsVirtualKeyCode).toBe(9);
  });

  it('press refuses a key it does not know, listing the ones it does', async () => {
    await expect(act('press', { key: 'F13' })).rejects.toThrow(/Enter, Tab/);
  });

  it('scroll wheels at the viewport centre, positive down', async () => {
    await act('scroll', { deltaY: 500 });
    const wheel = browser.state.inputs.find((i) => i.params.type === 'mouseWheel');
    expect(wheel.params.x).toBe(640);
    expect(wheel.params.deltaY).toBe(500);
  });

  it('read returns the page text, truncated at maxChars with a hint', async () => {
    const { text } = await act('read', { maxChars: 100 });
    expect(text.length).toBeLessThan(200);
    expect(text).toContain('truncated at 100');
  });

  it('navigate assumes https for a bare domain, because that is what agents type', async () => {
    const { url } = await act('navigate', { url: 'example.com' });
    expect(url).toBe('https://example.com');
  });

  it('back walks the real history', async () => {
    const { url } = await act('back');
    expect(url).toBe('https://previous.example/');
  });
});

describe('a tight budget keeps the things you can act on', () => {
  it('THE REGRESSION: drops orientation before refs, so the search box survives', async () => {
    // Measured on duckduckgo.com. The marketing sections that precede the
    // search box spent the whole budget on headings, the walk stopped at the
    // cap, and the one element anybody opens that page to use was never
    // listed — with nothing in the output to suggest it had been cut.
    const headings = Array.from({ length: 40 }, (_, i) => ({
      ignored: false,
      role: { value: 'heading' },
      name: { value: `Marketing section ${i} with a fairly long orientation title` },
      backendDOMNodeId: 200 + i,
    }));
    browser.state.axNodes = [
      ...headings,
      {
        ignored: false, role: { value: 'textbox' }, name: { value: 'Search the web' }, backendDOMNodeId: 999,
      },
    ];

    const { snapshot } = await act('snapshot', { maxChars: 600 });

    expect(snapshot).toContain('@e1 textbox "Search the web"');
    expect(snapshot).toContain('context lines omitted');
  });

  it('COUNTS the refs it could not fit, rather than implying there are none', async () => {
    // "No button matched" and "more buttons than fit" are different answers
    // and lead to different next moves. Silence reads as the first.
    browser.state.axNodes = Array.from({ length: 60 }, (_, i) => ({
      ignored: false,
      role: { value: 'button' },
      name: { value: `Button number ${i} with a reasonably long accessible name` },
      backendDOMNodeId: 300 + i,
    }));

    const { snapshot } = await act('snapshot', { maxChars: 500 });

    expect(snapshot).toMatch(/more interactive element/);
    expect(snapshot).toContain('@e1 ');
  });

  it('keeps every ref spendable even when it was not printed', async () => {
    // The ref map is a superset of what fits on screen, so an element the
    // agent learned about in an earlier, roomier snapshot still works.
    browser.state.axNodes = Array.from({ length: 30 }, (_, i) => ({
      ignored: false,
      role: { value: 'button' },
      name: { value: `Button number ${i} with a reasonably long accessible name` },
      backendDOMNodeId: 300 + i,
    }));

    await act('snapshot', { maxChars: 400 });
    // e30 was minted but almost certainly not shown at that budget.
    const result = await act('click', { ref: 'e30' });
    expect(result.url).toBeTruthy();
  });

  it('says nothing about omissions when everything fits', async () => {
    const { snapshot } = await act('snapshot');
    expect(snapshot).toContain('heading "Welcome"');
    expect(snapshot).toContain('@e1 button "Sign In"');
    expect(snapshot).not.toMatch(/omitted|did not fit/);
  });
});

describe('the connection is working memory, not a per-call cost', () => {
  it('reuses one connection across verbs', async () => {
    await act('snapshot');
    await act('read');
    await act('press', { key: 'Tab' });
    expect(browser.state.connections).toBe(1);
  });

  it('reconnects after the browser drops, instead of replaying a dead socket', async () => {
    await act('read');
    await browser.close();
    browser = await fakeBrowser();
    // Old endpoint died; new browser at a NEW port — the driver must not hold
    // the corpse. (A same-port restart is the same path: closed socket -> drop.)
    const { text } = await act('read');
    expect(text).toContain('PAGE TEXT');
    expect(browser.state.connections).toBe(1);
  });
});
