/**
 * CONTRACT for the unified browser tool: it is a DISPATCHER, and dispatch is
 * the whole job — the right engine, with only the parameters that engine
 * declares, and a refusal that teaches when the action is wrong.
 *
 * The engines' own behavior is pinned in their own suites (browserActDriver,
 * ai-browser-use, ai-browser-control); nothing here re-tests it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const actExecute = vi.fn();
vi.mock('./ai-browser-act.js', () => ({
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
vi.mock('./ai-browser-use.js', () => ({
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
vi.mock('./ai-browser-control.js', () => ({
  default: {
    execute: (...a) => controlExecute(...a),
    constructor: {
      schema: { parameters: { python: {}, timeoutSeconds: {}, browser: {} } },
    },
  },
}));

const { default: browser } = await import('./browser.js');

const ENGINE = { userId: 'u1', provider: 'anthropic' };

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
    await browser.execute({ action: 'script', python: 'print(1)', timeoutSeconds: 30 }, {}, ENGINE);

    expect(controlExecute).toHaveBeenCalledTimes(1);
    expect(controlExecute.mock.calls[0][0]).toEqual({ python: 'print(1)', timeoutSeconds: 30 });
    // The engine's execute checks isChatRun(workflowEngine) itself, so the
    // gate holds whether it is reached through this façade or directly.
    expect(controlExecute.mock.calls[0][2]).toBe(ENGINE);
  });

  it('refuses script without python', async () => {
    const out = await browser.execute({ action: 'script' }, {}, ENGINE);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/python/);
    expect(controlExecute).not.toHaveBeenCalled();
  });
});

describe('a wrong action teaches the shape of the tool', () => {
  it('names the verbs AND both delegation actions', async () => {
    const out = await browser.execute({ action: 'hover' }, {}, ENGINE);
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
