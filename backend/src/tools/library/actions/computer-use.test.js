/**
 * CONTRACT for the unified Computer Use tool: it is a DISPATCHER, and dispatch
 * is the whole job — the right engine, with only the parameters that engine
 * declares, the route's verb forced, and a refusal that teaches.
 *
 * The engines' own behavior is pinned in computerUse.test.js and
 * computerUse.regressions.test.js; nothing here re-tests the driver.
 */

import {
  describe, it, expect, beforeEach, vi,
} from 'vitest';

const inputExecute = vi.fn();
vi.mock('../computerEngines/computer-input.js', () => ({
  default: {
    execute: (...a) => inputExecute(...a),
    constructor: {
      schema: {
        parameters: {
          action: {}, pid: {}, windowId: {}, elementToken: {}, text: {}, keys: {},
          menuPath: {}, x: {}, y: {}, confirm: {}, deliveryMode: {},
        },
        outputs: { success: {}, effect: {}, route: {} },
      },
    },
  },
}));

const observeExecute = vi.fn();
vi.mock('../computerEngines/computer-observe.js', () => ({
  default: {
    execute: (...a) => observeExecute(...a),
    constructor: {
      schema: {
        parameters: {
          mode: {}, pid: {}, windowId: {}, query: {}, maxElements: {}, x1: {}, y1: {},
        },
        outputs: { success: {}, snapshotId: {}, elements: {} },
      },
    },
  },
}));

const windowsExecute = vi.fn();
vi.mock('../computerEngines/computer-windows.js', () => ({
  default: {
    execute: (...a) => windowsExecute(...a),
    constructor: {
      schema: {
        parameters: { include: {}, filter: {}, runningOnly: {} },
        outputs: { success: {}, windows: {}, apps: {} },
      },
    },
  },
}));

const sessionExecute = vi.fn();
vi.mock('../computerEngines/computer-session.js', () => ({
  default: {
    execute: (...a) => sessionExecute(...a),
    constructor: {
      schema: {
        parameters: {
          action: {}, session: {}, captureScope: {}, reason: {}, themeId: {}, confirm: {},
        },
        outputs: { success: {}, session: {} },
      },
    },
  },
}));

const setupExecute = vi.fn();
vi.mock('../computerEngines/computer-setup.js', () => ({
  default: {
    execute: (...a) => setupExecute(...a),
    constructor: {
      schema: {
        parameters: {
          action: {}, key: {}, value: {}, confirm: {},
        },
        outputs: { success: {}, installed: {}, daemon: {} },
      },
    },
  },
}));

const { default: computerUse, ACTION_NAMES } = await import('./computer-use.js');

const ENGINE_CTX = { userId: 'u1' };

beforeEach(() => {
  vi.clearAllMocks();
  inputExecute.mockResolvedValue({ success: true, effect: 'verified' });
  observeExecute.mockResolvedValue({ success: true, snapshotId: 's1' });
  windowsExecute.mockResolvedValue({ success: true, windows: [] });
  sessionExecute.mockResolvedValue({ success: true });
  setupExecute.mockResolvedValue({ success: true });
});

describe('it is ONE tool, and the verbs are actions on it', () => {
  it('is named for what it is, not for the verbs it contains', () => {
    const { schema } = computerUse.constructor;
    expect(schema.title).toBe('Computer Use');
    // The old title was "Computer Input (Click / Type / Menu / Keys /
    // Clipboard)" -- a name listing its own verbs, which is what a name must do
    // when the verbs cannot be actions on one tool. They can be.
    expect(schema.title).not.toMatch(/[()/]/);
  });

  it('carries every verb the five engines had', () => {
    for (const verb of [
      'click', 'double_click', 'right_click', 'type', 'paste_text', 'press_key',
      'hotkey', 'scroll', 'set_value', 'drag', 'invoke_menu', 'clipboard_read',
      'clipboard_write', 'set_window_frame', 'launch_app', 'bring_to_front', 'kill_app',
      'list_windows', 'list_apps', 'observe', 'observe_desktop', 'zoom', 'verify',
      'session_start', 'session_end', 'cursor_on', 'cursor_off',
      'ensure', 'doctor', 'health', 'driver_status',
    ]) {
      expect(ACTION_NAMES, verb).toContain(verb);
    }
  });

  it('gives every action exactly one meaning', () => {
    // The five schemas collided: observe's mode "window" vs windows' include
    // "windows", setup's "status" vs session's "state". A single schema is only
    // un-mis-pickable if one name cannot mean two things.
    expect(new Set(ACTION_NAMES).size).toBe(ACTION_NAMES.length);
    expect(ACTION_NAMES).toContain('driver_status');
    expect(ACTION_NAMES).toContain('session_state');
    expect(ACTION_NAMES).not.toContain('status');
    expect(ACTION_NAMES).not.toContain('state');
  });
});

describe('dispatch sends each action to its own engine', () => {
  it('routes LOOK actions', async () => {
    await computerUse.execute({ action: 'list_windows' }, {}, ENGINE_CTX);
    expect(windowsExecute).toHaveBeenCalledWith(
      expect.objectContaining({ include: 'windows' }), {}, ENGINE_CTX,
    );

    await computerUse.execute({ action: 'list_apps' }, {}, ENGINE_CTX);
    expect(windowsExecute).toHaveBeenLastCalledWith(
      expect.objectContaining({ include: 'apps' }), {}, ENGINE_CTX,
    );

    await computerUse.execute({ action: 'observe', pid: 12 }, {}, ENGINE_CTX);
    expect(observeExecute).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'window', pid: 12 }), {}, ENGINE_CTX,
    );

    await computerUse.execute({ action: 'zoom', x1: 5 }, {}, ENGINE_CTX);
    expect(observeExecute).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'zoom', x1: 5 }), {}, ENGINE_CTX,
    );
  });

  it('routes ACT actions with the verb intact', async () => {
    await computerUse.execute(
      { action: 'click', pid: 12, elementToken: 'tok', confirm: 'true' }, {}, ENGINE_CTX,
    );
    expect(inputExecute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'click', pid: 12, elementToken: 'tok' }), {}, ENGINE_CTX,
    );

    await computerUse.execute(
      { action: 'invoke_menu', menuPath: 'File>Save', confirm: 'true' }, {}, ENGINE_CTX,
    );
    expect(inputExecute).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'invoke_menu', menuPath: 'File>Save' }), {}, ENGINE_CTX,
    );
  });

  it('routes DIAGNOSE and SESSION actions to their own engines', async () => {
    await computerUse.execute({ action: 'doctor' }, {}, ENGINE_CTX);
    expect(setupExecute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'doctor' }), {}, ENGINE_CTX,
    );

    // driver_status must reach setup as "status" -- the rename exists to
    // disambiguate from session_state, not to change what the engine runs.
    await computerUse.execute({ action: 'driver_status' }, {}, ENGINE_CTX);
    expect(setupExecute).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'status' }), {}, ENGINE_CTX,
    );

    await computerUse.execute({ action: 'session_state' }, {}, ENGINE_CTX);
    expect(sessionExecute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'state' }), {}, ENGINE_CTX,
    );
  });

  it('hands each engine ONLY the parameters it declares', async () => {
    // The union carries 40+ parameters. Handing observe's `query` to the input
    // engine would fail its schema validation.
    await computerUse.execute({
      action: 'click', pid: 12, confirm: 'true', query: 'not-an-input-param', maxElements: 50,
    }, {}, ENGINE_CTX);

    const forwarded = inputExecute.mock.calls[0][0];
    expect(forwarded).toHaveProperty('pid', 12);
    expect(forwarded).not.toHaveProperty('query');
    expect(forwarded).not.toHaveProperty('maxElements');
  });
});

describe('it refuses in a way that teaches', () => {
  it('names the alternatives for an unknown action', async () => {
    const out = await computerUse.execute({ action: 'frobnicate' }, {}, ENGINE_CTX);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/frobnicate/);
    expect(out.error).toMatch(/list_windows/);
    expect(out.error).toMatch(/click/);
    expect(inputExecute).not.toHaveBeenCalled();
  });

  it('refuses an ACT action without confirm, naming the action the caller used', async () => {
    const out = await computerUse.execute({ action: 'click', pid: 12 }, {}, ENGINE_CTX);
    expect(out.success).toBe(false);
    expect(out.code).toBe('confirm_required');
    expect(out.error).toMatch(/action="click"/);
    expect(inputExecute).not.toHaveBeenCalled();
  });

  it('does NOT require confirm to look', async () => {
    // Reading the screen changes nothing. Gating it behind confirm would make
    // the safe first step as expensive as the dangerous one.
    for (const action of ['list_windows', 'observe', 'doctor']) {
      const out = await computerUse.execute({ action }, {}, ENGINE_CTX);
      expect(out.success, action).not.toBe(false);
    }
  });
});
