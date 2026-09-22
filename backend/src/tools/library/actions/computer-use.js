import BaseAction from '../BaseAction.js';
import inputTool from '../computerEngines/computer-input.js';
import observeTool from '../computerEngines/computer-observe.js';
import windowsTool from '../computerEngines/computer-windows.js';
import sessionTool from '../computerEngines/computer-session.js';
import setupTool from '../computerEngines/computer-setup.js';

/**
 * THE Computer Use tool — one tool, and click/type/menu/keys/clipboard are
 * ACTIONS on it.
 *
 * WHY ONE TOOL
 * ------------
 * This was five tools: computer-input, computer-observe, computer-windows,
 * computer-session and computer-setup. They were never five capabilities. They
 * are five stages of ONE capability — driving the computer — against one
 * binary, the Cua Driver:
 *
 *   what can I drive?        list_windows      (windows engine)
 *   what is on screen?       observe           (observe engine)
 *   do the thing             click/type/...    (input engine)
 *   is the driver healthy?   doctor/health     (setup engine)
 *
 * The split leaked into the names. "Computer Input (Click / Type / Menu /
 * Keys / Clipboard)" is a tool title listing its own verbs, which is what a
 * title has to do when the verbs could not be actions on a single tool. They
 * can be. So they are, and the titles say what the tools ARE again.
 *
 * A FAÇADE, NOT A REWRITE
 * -----------------------
 * This file is a dispatcher. Every engine is unchanged and keeps its own
 * confirm gates, its serialized operation queue, its fail-closed element
 * addressing and its outcome normalization. Nothing about how the driver is
 * spoken to moved.
 *
 * THE ENGINES ARE NOT TOOLS. They live in `library/computerEngines/`, which is
 * deliberately NOT one of the directories ToolRegistry scans, so they cannot
 * register themselves however valid their schemas are. A tool is a file in a
 * scanned category; the machinery is not in one.
 *
 * WHY EACH ENGINE SEES ONLY ITS OWN PARAMETERS
 * --------------------------------------------
 * BaseAction validates params against the executing tool's schema, and the
 * union of five schemas contains parameters no single engine declares. The
 * dispatch filters to the keys each engine declares, derived from the engine's
 * own schema rather than hand-listed, so a parameter added to an engine is
 * forwarded without anyone remembering to edit this file.
 *
 * ACTION NAMES ARE UNAMBIGUOUS ACROSS ENGINES. The five schemas had genuine
 * collisions — observe's mode "window" vs windows' include "windows", setup's
 * "status" vs session's "state". The union renames them so one action name can
 * only ever mean one thing, which is the entire reason a single schema cannot
 * be mis-picked the way five competing ones could.
 */

/** action -> { engine, params to force }. One name, one meaning. */
const ROUTES = {
  // ── LOOK ──────────────────────────────────────────────────────────────
  list_windows: { engine: 'windows', force: { include: 'windows' } },
  list_apps: { engine: 'windows', force: { include: 'apps' } },
  list_windows_and_apps: { engine: 'windows', force: { include: 'both' } },
  observe: { engine: 'observe', force: { mode: 'window' } },
  observe_desktop: { engine: 'observe', force: { mode: 'desktop' } },
  zoom: { engine: 'observe', force: { mode: 'zoom' } },
  verify: { engine: 'observe', force: { mode: 'verify' } },

  // ── ACT (the input engine's own verbs, passed straight through) ───────
  click: { engine: 'input' },
  double_click: { engine: 'input' },
  right_click: { engine: 'input' },
  type: { engine: 'input' },
  paste_text: { engine: 'input' },
  press_key: { engine: 'input' },
  hotkey: { engine: 'input' },
  scroll: { engine: 'input' },
  set_value: { engine: 'input' },
  drag: { engine: 'input' },
  // A path with the button held through every point. What painting, signing
  // and slider-scrubbing need and a two-point drag cannot give.
  stroke: { engine: 'input' },
  invoke_menu: { engine: 'input' },
  clipboard_read: { engine: 'input' },
  clipboard_write: { engine: 'input' },
  set_window_frame: { engine: 'input' },
  launch_app: { engine: 'input' },
  bring_to_front: { engine: 'input' },
  kill_app: { engine: 'input' },

  // ── SESSION (agent cursor + capture scope) ───────────────────────────
  session_start: { engine: 'session', force: { action: 'start' } },
  session_state: { engine: 'session', force: { action: 'state' } },
  session_escalate: { engine: 'session', force: { action: 'escalate' } },
  session_end: { engine: 'session', force: { action: 'end' } },
  cursor_on: { engine: 'session', force: { action: 'cursor_on' } },
  cursor_off: { engine: 'session', force: { action: 'cursor_off' } },
  cursor_theme: { engine: 'session', force: { action: 'cursor_theme' } },

  // ── DIAGNOSE (the driver itself) ─────────────────────────────────────
  ensure: { engine: 'setup', force: { action: 'ensure' } },
  doctor: { engine: 'setup', force: { action: 'doctor' } },
  health: { engine: 'setup', force: { action: 'health' } },
  driver_status: { engine: 'setup', force: { action: 'status' } },
  permissions: { engine: 'setup', force: { action: 'permissions' } },
  config: { engine: 'setup', force: { action: 'config' } },
  driver_tools: { engine: 'setup', force: { action: 'tools' } },
  install: { engine: 'setup', force: { action: 'install' } },
  update: { engine: 'setup', force: { action: 'update' } },
  serve: { engine: 'setup', force: { action: 'serve' } },
  stop: { engine: 'setup', force: { action: 'stop' } },
  version: { engine: 'setup', force: { action: 'version' } },
};

const ENGINES = {
  input: inputTool,
  observe: observeTool,
  windows: windowsTool,
  session: sessionTool,
  setup: setupTool,
};

/** Actions that need confirm=true, because they change the real machine. */
const NEEDS_CONFIRM = new Set(
  Object.entries(ROUTES).filter(([, r]) => r.engine === 'input').map(([name]) => name),
);

const ACTION_NAMES = Object.keys(ROUTES);

class ComputerUse extends BaseAction {
  static schema = {
    title: 'Computer Use',
    category: 'action',
    type: 'computer-use',
    icon: 'connect',
    description: 'Drive this computer: real windows, real clicks, real typing. ONE tool — every capability is an `action`. '
      + 'LOOK: list_windows (what can I drive? pid + windowId for everything open), list_apps (what is installed, with a '
      + 'launchPath), observe (the window\'s accessibility tree + screenshot — every element gets an elementToken), '
      + 'observe_desktop, zoom, verify. ACT (needs confirm=true): click, double_click, right_click, type, paste_text, '
      + 'press_key, hotkey, scroll, set_value, drag, stroke (a path: points=[{x,y},...] with the button held throughout '
      + '— for painting, signing, scrubbing), invoke_menu, clipboard_read, clipboard_write, set_window_frame, '
      + 'launch_app, bring_to_front, kill_app. '
      + 'CANVASES (Paint, WebGL, video, custom-drawn): they have no accessibility tree, so observe reports '
      + 'ax_tree_empty and escalation=px — that is the signal to act by pixel off the screenshot with '
      + 'deliveryMode="foreground" (a canvas needs real pointer capture, which only SendInput gives). '
      + 'Use stroke, not drag, for anything that is a line rather than a jump. '
      + 'ADDRESSING: target elements with elementToken from the LATEST observe (preferred) or elementIndex+snapshotId; '
      + 'a stale token is refused rather than clicked blind. Window-local x/y works for canvas surfaces. '
      + 'DELIVERY: background is the default and the mandatory first attempt — no cursor warp, no focus steal, no window '
      + 'raise. Escalate to foreground only when the driver itself says background is impossible. '
      + 'OUTCOMES: read `effect` — effect="unverifiable" means the driver will not overclaim, NOT that the action failed. '
      + 'SESSION: session_start/session_state/session_end and cursor_on/cursor_off control the agent cursor and capture '
      + 'scope. DIAGNOSE: ensure (one-call bootstrap — install, start daemon, health probe), doctor, health, '
      + 'driver_status, permissions, config. The driver auto-starts, so LOOK and ACT work without calling ensure first.',
    parameters: {
      action: {
        type: 'string',
        inputType: 'select',
        required: true,
        options: ACTION_NAMES,
        description: 'What to do. LOOK: list_windows, list_apps, list_windows_and_apps, observe, observe_desktop, zoom, verify. '
          + 'ACT: click, double_click, right_click, type, paste_text, press_key, hotkey, scroll, set_value, drag, stroke, invoke_menu, '
          + 'clipboard_read, clipboard_write, set_window_frame, launch_app, bring_to_front, kill_app. '
          + 'SESSION: session_start, session_state, session_escalate, session_end, cursor_on, cursor_off, cursor_theme. '
          + 'DIAGNOSE: ensure, doctor, health, driver_status, permissions, config, driver_tools, install, update, serve, stop, version.',
      },
      confirm: {
        type: 'string',
        inputType: 'checkbox',
        required: false,
        options: ['true'],
        description: 'Required for every ACT action, because they change the real machine the user is sitting at.',
      },
      ...ComputerUse.unionParameters(),
    },
    outputs: ComputerUse.unionOutputs(),
  };

  /**
   * Every engine parameter except the ones the union owns.
   *
   * `action` is the union's own selector, and each engine's `action`/`mode`/
   * `include` is forced by the route — so taking them from the engines would
   * overwrite the selector with the engine's narrower enum. `confirm` is
   * declared once by the union.
   */
  static unionParameters() {
    const OWNED = new Set(['action', 'mode', 'include', 'confirm']);
    const merged = {};
    for (const engine of [inputTool, observeTool, windowsTool, sessionTool, setupTool]) {
      const params = engine?.constructor?.schema?.parameters || {};
      for (const [name, spec] of Object.entries(params)) {
        if (OWNED.has(name)) continue;
        // First engine to declare a parameter owns its description. They are
        // the same concept across engines (pid, windowId, session), so the
        // first definition is correct rather than arbitrary.
        if (!merged[name]) merged[name] = spec;
      }
    }
    return merged;
  }

  /** Every output any engine can return, deduped. */
  static unionOutputs() {
    const merged = {};
    for (const engine of [inputTool, observeTool, windowsTool, sessionTool, setupTool]) {
      const outputs = engine?.constructor?.schema?.outputs || {};
      for (const [name, spec] of Object.entries(outputs)) {
        if (!merged[name]) merged[name] = spec;
      }
    }
    return merged;
  }

  constructor() {
    super('computer-use');
  }

  /** The union schema's params, filtered to what one engine declares. */
  static paramsFor(engine, params) {
    const declared = Object.keys(engine?.constructor?.schema?.parameters || {});
    const picked = {};
    for (const name of declared) {
      if (params[name] !== undefined) picked[name] = params[name];
    }
    return picked;
  }

  async execute(params, inputData, workflowEngine) {
    const action = String(params?.action || '').trim();
    const route = ROUTES[action];

    if (!route) {
      return this.formatOutput({
        success: false,
        error: `Unknown computer action "${action || '(none)'}". `
          + `LOOK: list_windows, list_apps, observe, observe_desktop, zoom, verify. `
          + `ACT: click, double_click, right_click, type, paste_text, press_key, hotkey, scroll, set_value, drag, `
          + `invoke_menu, clipboard_read, clipboard_write, set_window_frame, launch_app, bring_to_front, kill_app. `
          + `DIAGNOSE: ensure, doctor, health, driver_status.`,
      });
    }

    const engine = ENGINES[route.engine];
    const forwarded = {
      ...ComputerUse.paramsFor(engine, params),
      ...(route.force || {}),
    };

    // The engines enforce confirm themselves; this only makes the refusal name
    // the action the caller actually used rather than the engine's verb.
    if (NEEDS_CONFIRM.has(action) && String(params?.confirm) !== 'true') {
      return this.formatOutput({
        success: false,
        refused: true,
        code: 'confirm_required',
        error: `action="${action}" acts on the real machine, so it needs confirm=true.`,
      });
    }

    return engine.execute(forwarded, inputData, workflowEngine);
  }
}

export default new ComputerUse();
export { ROUTES as COMPUTER_ACTIONS, ACTION_NAMES };
