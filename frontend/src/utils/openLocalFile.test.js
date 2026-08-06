/**
 * Clicking a link to a local file must reach the OS, not an unauthenticated
 * HTTP request. See openLocalFile.js for the failure this replaces.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { handleLocalFileLinkClick, localPathFromAnchor, openLocalPath } from './openLocalFile.js';
import { LOCAL_PATH_ATTR } from './localFileUrl.js';

const WIN = 'C:/Users/Studio/AppData/Roaming/AGNT/projects/report.html';

/**
 * Render HTML and click the element matching `selector`, reporting what the
 * handler did.
 *
 * `defaultPrevented` is sampled the instant our handler returns, not after
 * dispatch, because the document listener below then cancels the event
 * unconditionally — jsdom cannot navigate and logs a
 * "Not implemented: navigation" stack for every un-cancelled link click, which
 * is a page of noise that makes a real failure hard to see.
 */
function click(html, selector = 'a', init = {}) {
  document.body.innerHTML = `<div id="host">${html}</div>`;
  const el = document.querySelector(selector);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  let handled = false;
  let defaultPrevented = false;
  document.getElementById('host').addEventListener('click', (e) => {
    handled = handleLocalFileLinkClick(e);
    defaultPrevented = e.defaultPrevented;
  });
  document.addEventListener('click', (e) => e.preventDefault(), { once: true });
  el.dispatchEvent(event);
  return { handled, defaultPrevented };
}

let openPath;
let windowOpen;

beforeEach(() => {
  openPath = vi.fn();
  windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
});

afterEach(() => {
  delete window.electron;
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('localPathFromAnchor', () => {
  it('prefers the stamped path, and falls back to parsing a raw file:// href', () => {
    document.body.innerHTML = `
      <a id="stamped" href="file:///${WIN}" ${LOCAL_PATH_ATTR}="${WIN}">a</a>
      <a id="raw" href="file:///${WIN}">b</a>
      <a id="web" href="https://agnt.gg">c</a>`;
    expect(localPathFromAnchor(document.getElementById('stamped'))).toBe(WIN);
    expect(localPathFromAnchor(document.getElementById('raw'))).toBe(WIN);
    expect(localPathFromAnchor(document.getElementById('web'))).toBe('');
    expect(localPathFromAnchor(null)).toBe('');
  });
});

describe('in the desktop app', () => {
  beforeEach(() => {
    window.electron = { openPath };
  });

  it('hands the real path to the OS and cancels the navigation', () => {
    const { handled, defaultPrevented } = click(
      `<a href="file:///${WIN}" ${LOCAL_PATH_ATTR}="${WIN}" target="_blank">Open</a>`
    );
    expect(handled).toBe(true);
    expect(openPath).toHaveBeenCalledWith(WIN);
    // Without preventDefault the anchor ALSO opens — target=_blank goes to
    // shell.openExternal, which is the 401 this exists to stop.
    expect(defaultPrevented).toBe(true);
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('works when the click lands on a child of the anchor', () => {
    click(`<a href="file:///${WIN}" ${LOCAL_PATH_ATTR}="${WIN}"><strong id="inner">Open</strong></a>`, '#inner');
    expect(openPath).toHaveBeenCalledWith(WIN);
  });

  it('never touches an ordinary web link', () => {
    const { handled, defaultPrevented } = click('<a href="https://agnt.gg/docs">docs</a>');
    expect(handled).toBe(false);
    expect(openPath).not.toHaveBeenCalled();
    expect(defaultPrevented, 'hijacking normal links would break every link in chat').toBe(false);
  });

  it('never touches a click that is not on a link at all', () => {
    const { handled } = click('<p id="text">hello</p>', '#text');
    expect(handled).toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });

  it('leaves modified and non-primary clicks to the browser', () => {
    // ctrl/cmd-click and middle-click mean "open the way you normally would".
    // The main-process net catches whatever that produces.
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const { handled, defaultPrevented } = click(
        `<a href="file:///${WIN}" ${LOCAL_PATH_ATTR}="${WIN}">Open</a>`,
        'a',
        init
      );
      expect(handled, JSON.stringify(init)).toBe(false);
      expect(defaultPrevented, JSON.stringify(init)).toBe(false);
    }
    expect(openPath).not.toHaveBeenCalled();
  });
});

describe('in the browser / Docker, where there is no Electron bridge', () => {
  it('falls back to the streaming URL, which is same-origin and DOES carry the cookie', () => {
    const { handled } = click(`<a href="file:///${WIN}" ${LOCAL_PATH_ATTR}="${WIN}">Open</a>`);
    expect(handled).toBe(true);
    expect(windowOpen).toHaveBeenCalledTimes(1);
    expect(windowOpen.mock.calls[0][0]).toContain(`/local-file/${WIN}`);
    expect(windowOpen.mock.calls[0][1]).toBe('_blank');
  });
});

describe('openLocalPath', () => {
  it('refuses an empty path instead of opening something arbitrary', () => {
    window.electron = { openPath };
    expect(openLocalPath('')).toBe(false);
    expect(openLocalPath('   ')).toBe(false);
    expect(openLocalPath(null)).toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });
});
