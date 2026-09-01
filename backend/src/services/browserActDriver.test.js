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
          return reply({ model: { content: [10, 20, 110, 20, 110, 60, 10, 60] } });
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
