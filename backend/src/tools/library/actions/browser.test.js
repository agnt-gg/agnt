/**
 * CONTRACT for the unified browser tool: it is a DISPATCHER, and dispatch is
 * the whole job — the right engine, with only the parameters that engine
 * declares, and a refusal that teaches when the action is wrong.
 *
 * The engines' own behavior is pinned in their own suites (browserActDriver,
 * ai-browser-use, ai-browser-control, now under library/browserEngines/);
 * nothing here re-tests it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const actExecute = vi.fn();
vi.mock('../browserEngines/ai-browser-act.js', () => ({
  default: {
    execute: (...a) => actExecute(...a),
    constructor: {
      schema: {
        parameters: {
          action: {}, url: {}, ref: {}, selector: {}, text: {}, submit: {}, key: {}, deltaY: {}, query: {}, maxChars: {},
        },
      },
    },
  },
}));

const useExecute = vi.fn();
vi.mock('../browserEngines/ai-browser-use.js', () => ({
  default: {
    execute: (...a) => useExecute(...a),
    constructor: {
      schema: {
        parameters: {
          instructions: {}, provider: {}, model: {}, secrets: {}, externalWindow: {}, timeoutSeconds: {},
        },
      },
    },
  },
}));

const controlExecute = vi.fn();
vi.mock('../browserEngines/ai-browser-control.js', () => ({
  default: {
    execute: (...a) => controlExecute(...a),
    constructor: {
      schema: { parameters: { python: {}, timeoutSeconds: {}, browser: {} } },
    },
  },
}));

const { default: browser, userAskedForBrowser } = await import('./browser.js');

const ENGINE = { userId: 'u1', provider: 'anthropic' };
/** A chat turn whose user asked for the browser — the only turn script may run on. */
const ASKED = { ...ENGINE, latestUserMessage: 'use the browser to check the pricing page' };

beforeEach(() => {
  vi.clearAllMocks();
  actExecute.mockResolvedValue({ success: true, url: 'https://x/' });
  useExecute.mockResolvedValue({ success: true, result: 'done' });
  controlExecute.mockResolvedValue({ success: true, output: 'ok' });
});

describe('verbs go to the verb engine', () => {
  it('routes every verb, with the engine untouched otherwise', async () => {
    for (const action of ['navigate', 'snapshot', 'click', 'type', 'press', 'scroll', 'read', 'back']) {
      actExecute.mockClear();
      await browser.execute({ action, url: 'x.com', ref: 'e1' }, {}, ENGINE);
      expect(actExecute).toHaveBeenCalledTimes(1);
      expect(actExecute.mock.calls[0][0].action).toBe(action);
      // The engine receives the same workflowEngine — identity, not a copy.
      expect(actExecute.mock.calls[0][2]).toBe(ENGINE);
    }
    expect(useExecute).not.toHaveBeenCalled();
    expect(controlExecute).not.toHaveBeenCalled();
  });

  it('does not leak delegation params into the verb engine', async () => {
    await browser.execute({ action: 'click', ref: 'e1', instructions: 'irrelevant', python: 'nope' }, {}, ENGINE);
    const sent = actExecute.mock.calls[0][0];
    expect(sent.instructions).toBeUndefined();
    expect(sent.python).toBeUndefined();
    expect(sent.ref).toBe('e1');
  });
});

describe('run goes to the autonomous agent', () => {
  it('forwards only what that engine declares — no verb params, no action', async () => {
    await browser.execute({
      action: 'run', instructions: 'book a table', ref: 'e1', url: 'x.com', secrets: '{}',
    }, {}, ENGINE);

    expect(useExecute).toHaveBeenCalledTimes(1);
    const sent = useExecute.mock.calls[0][0];
    expect(sent.instructions).toBe('book a table');
    expect(sent.secrets).toBe('{}');
    // `action` and `ref` are not in browser-use's schema; forwarding them
    // would make ITS validator answer for OUR union schema.
    expect(sent.action).toBeUndefined();
    expect(sent.ref).toBeUndefined();
  });

  it('refuses run without instructions, and says what run is for', async () => {
    const out = await browser.execute({ action: 'run' }, {}, ENGINE);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/instructions/);
    expect(useExecute).not.toHaveBeenCalled();
  });
});

describe('script goes to the raw-control engine', () => {
  it('forwards python and passes the SAME workflowEngine — the chat gate lives in the engine', async () => {
    await browser.execute({ action: 'script', python: 'print(1)', timeoutSeconds: 30 }, {}, ASKED);

    expect(controlExecute).toHaveBeenCalledTimes(1);
    expect(controlExecute.mock.calls[0][0]).toEqual({ python: 'print(1)', timeoutSeconds: 30 });
    // The engine's execute checks isChatRun(workflowEngine) itself, so the
    // gate holds whether it is reached through this façade or directly.
    expect(controlExecute.mock.calls[0][2]).toBe(ASKED);
  });

  // THE BUG THIS PINS (trace c59eb9e9, 2026-10-06): mid-way through UI work the
  // model ran a script to read an environment variable. The user had asked
  // for nothing browser-shaped; a browser launched and a blank card appeared.
  it('is refused in chat when the user did not ask for a browser — and no browser is touched', async () => {
    for (const latestUserMessage of [undefined, '', 'make the files page match our brand and add a list mode']) {
      controlExecute.mockClear();
      const out = await browser.execute({ action: 'script', python: 'print(1)' }, {}, { ...ENGINE, latestUserMessage });
      expect(out.success).toBe(false);
      expect(out.error).toMatch(/reserved for when the user asks for the browser/);
      // It teaches the right tool rather than just saying no.
      expect(out.error).toMatch(/read_file/);
      expect(controlExecute).not.toHaveBeenCalled();
    }
  });

  it('leaves workflows to the engine, which refuses script there for its own reason', async () => {
    const WORKFLOW = { userId: 'u1' };
    await browser.execute({ action: 'script', python: 'print(1)' }, {}, WORKFLOW);
    expect(controlExecute).toHaveBeenCalledTimes(1);
  });

  it('does not gate the verbs — "open agnt.gg" is a fine reason to navigate', async () => {
    await browser.execute({ action: 'navigate', url: 'agnt.gg' }, {}, { ...ENGINE, latestUserMessage: 'what is on agnt.gg?' });
    expect(actExecute).toHaveBeenCalledTimes(1);
  });

  it('refuses script without python', async () => {
    const out = await browser.execute({ action: 'script' }, {}, ENGINE);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/python/);
    expect(controlExecute).not.toHaveBeenCalled();
  });
});

describe('userAskedForBrowser', () => {
  it('hears a browser, a named browser, its tooling, or signing in', () => {
    for (const msg of [
      'use the browser', 'open it in Chrome', 'try Brave', 'open Microsoft Edge', 'check devtools', 'drive it with playwright',
      'I need to log in to stripe', 'sign in for me', 'are we logged in?', 'BROWSER pls',
    ]) expect(userAskedForBrowser(msg), msg).toBe(true);
  });

  it('does not hear it in ordinary engineering requests', () => {
    for (const msg of [
      'fix the failing tests', 'make the files page better', 'check the localhost server', 'read the html file',
      'what is my edge case here', 'the login page has a bug', null, undefined, '',
    ]) expect(userAskedForBrowser(msg), String(msg)).toBe(false);
  });
});

describe('a wrong action teaches the shape of the tool', () => {
  it('names the verbs AND both delegation actions', async () => {
    const out = await browser.execute({ action: 'teleport' }, {}, ENGINE);
    expect(out.success).toBe(false);
    expect(out.error).toContain('navigate, snapshot, click');
    expect(out.error).toContain('"run"');
    expect(out.error).toContain('"script"');
  });

  it('treats a missing action the same way', async () => {
    const out = await browser.execute({}, {}, ENGINE);
    expect(out.success).toBe(false);
    expect(out.error).toContain('(none)');
  });
});
