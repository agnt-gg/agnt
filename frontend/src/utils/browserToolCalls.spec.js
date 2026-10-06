import { describe, it, expect } from 'vitest';
import { drivesBrowserPage, BROWSER_TOOL_NAMES } from './browserToolCalls.js';

const call = (action, extra = {}) => ({ id: 't1', name: 'browser', args: { action }, ...extra });

describe('drivesBrowserPage', () => {
  it('page verbs and delegated runs drive a page', () => {
    for (const action of ['navigate', 'click', 'type', 'snapshot', 'read', 'open', 'run']) {
      expect(drivesBrowserPage(call(action)), action).toBe(true);
    }
  });

  // trace c59eb9e9: a script that read an environment variable mounted an
  // empty live card and widget.
  it('a script or a diagnostic never surfaces a browser', () => {
    for (const action of ['script', 'console', 'errors', 'requests']) {
      expect(drivesBrowserPage(call(action)), action).toBe(false);
    }
    expect(drivesBrowserPage({ name: 'ai_browser_control', args: {} })).toBe(false);
  });

  it('a call still running counts — there is no result yet to say otherwise', () => {
    expect(drivesBrowserPage(call('navigate'))).toBe(true);
  });

  it('a failed or refused call has nothing to watch, whatever shape the result takes', () => {
    expect(drivesBrowserPage(call('navigate', { error: 'boom' }))).toBe(false);
    expect(drivesBrowserPage(call('navigate', { result: { success: false, error: 'Refusing to navigate to a file: URL.' } }))).toBe(false);
    expect(drivesBrowserPage(call('navigate', { result: JSON.stringify({ success: false }) }))).toBe(false);
    expect(drivesBrowserPage(call('navigate', { result: { result: { success: false } } }))).toBe(false);
    expect(drivesBrowserPage(call('navigate', { result: { success: true, url: 'https://agnt.gg/' } }))).toBe(true);
  });

  it('reads args in every shape a transcript stores them', () => {
    expect(drivesBrowserPage({ name: 'browser', args: JSON.stringify({ action: 'script' }) })).toBe(false);
    expect(drivesBrowserPage({ name: 'browser', arguments: { action: 'script' } })).toBe(false);
    expect(drivesBrowserPage({ name: 'browser', input: { action: 'navigate' } })).toBe(true);
  });

  it('history still renders: the consolidated names that drove pages count', () => {
    expect(BROWSER_TOOL_NAMES.has('ai_browser_use')).toBe(true);
    expect(drivesBrowserPage({ name: 'ai_browser_act', args: { action: 'navigate' } })).toBe(true);
    expect(drivesBrowserPage({ name: 'ai_browser_use', args: { instructions: 'x' } })).toBe(true);
  });

  it('anything else is not a browser', () => {
    for (const tc of [null, undefined, {}, { name: 'web_scrape' }, { name: 'computer_use', args: { action: 'click' } }]) {
      expect(drivesBrowserPage(tc)).toBe(false);
    }
  });
});
