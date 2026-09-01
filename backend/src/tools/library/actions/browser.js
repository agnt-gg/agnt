import BaseAction from '../BaseAction.js';
import actTool from './ai-browser-act.js';
import useTool from './ai-browser-use.js';
import controlTool from './ai-browser-control.js';
import { BROWSER_ACTIONS } from '../../../services/browserActDriver.js';

/**
 * THE browser tool — one tool, three levels of delegation.
 *
 * WHY ONE TOOL
 * ------------
 * The three browser tools were never three capabilities. They were one
 * capability at three levels of delegation:
 *
 *   click this button        a VERB        (ai-browser-act's engine)
 *   handle this whole task   a DELEGATION  (ai-browser-use's engine)
 *   run this script          a PROGRAM     (ai-browser-control's engine)
 *
 * Delegation level is just another parameter, so it became one: `action`.
 * Three competing schemas in the prompt meant the model had to guess which
 * tool to reach for — and the 2026-09-01 surprise-window bug was caused by
 * exactly that guess going wrong. One schema cannot be mis-picked.
 *
 * A FAÇADE, NOT A REWRITE
 * -----------------------
 * This file is a dispatcher. The engines stay where they are, unchanged:
 * verbs go to the CDP driver, `run` to the nested browser-use agent with all
 * its provider plumbing, `script` to the Python daemon. The legacy tools stay
 * registered so the existing workflow nodes keep executing — they are the
 * alias layer, scheduled for deletion one release after nothing depends on
 * them.
 *
 * WHY EACH ENGINE SEES ONLY ITS OWN PARAMETERS
 * --------------------------------------------
 * BaseAction validates params against the executing tool's schema. Handing the
 * union schema's params to an engine would ask browser-use to validate `ref`
 * and the verbs to validate `instructions` — so the dispatch filters to the
 * keys each engine declares. The filter is derived from the engine's own
 * schema rather than hand-listed, so a parameter added to an engine is
 * forwarded without anyone remembering to update this file.
 */
class Browser extends BaseAction {
  static schema = {
    title: 'Browser',
    category: 'action',
    type: 'browser',
    icon: 'globe',
    description: 'ONE browser tool, three levels of control. VERBS (default — each call is milliseconds, no nested agent): '
      + 'action="navigate" with url, then action="snapshot" to see the page as an accessibility tree where every '
      + 'interactive element has a @ref, then action="click" or "type" with that ref or a CSS selector — snapshot again '
      + 'after anything changes, because refs die on navigation. "read" returns page text, "press" sends a key (Enter '
      + 'submits), "scroll" moves the viewport, "back" is history. DELEGATION: action="run" with instructions hands the '
      + 'WHOLE task to an autonomous browser agent that reports back when finished — slow but self-sufficient, right for '
      + 'workflows and fire-and-forget jobs. ESCAPE HATCH: action="script" with python drives the browser with raw '
      + 'Python/CDP helpers, in chat only. A browser is always available: it drives the Browser widget when one is open '
      + 'and quietly opens a hidden one otherwise — never ask the user to open a browser, and never expect a visible OS '
      + 'window unless the user explicitly asked for one (externalWindow, run only).',
    parameters: {
      action: {
        type: 'string',
        inputType: 'text',
        description: 'One of: navigate, snapshot, click, type, press, scroll, read, back, run, script.',
      },
      url: {
        type: 'string',
        inputType: 'text',
        description: 'For navigate: where to go. A bare domain is fine — https:// is assumed.',
      },
      ref: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'For click/type: the @ref from the latest snapshot, e.g. "e12" or "@e12".',
      },
      selector: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'For click/type/read: CSS selector instead of a ref — stable across page loads, so it is the right handle for workflows.',
      },
      text: {
        type: 'string',
        inputType: 'text',
        description: 'For type: replaces what is in the field (it is selected first).',
      },
      submit: {
        type: 'boolean',
        inputType: 'checkbox',
        inputSize: 'half',
        default: false,
        description: 'For type: press Enter afterwards.',
      },
      key: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'For press: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, PageUp/Down, Home, End.',
      },
      deltaY: {
        type: 'number',
        inputType: 'number',
        inputSize: 'half',
        default: 600,
        description: 'For scroll: pixels; positive scrolls down.',
      },
      query: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'For snapshot: only include elements whose name or role contains this.',
      },
      maxChars: {
        type: 'number',
        inputType: 'number',
        inputSize: 'half',
        description: 'Cap for snapshot (default 8000) and read (default 6000).',
      },
      instructions: {
        type: 'string',
        inputType: 'textarea',
        description: 'For run: the whole task in plain English. The autonomous agent does the reasoning and reports back when finished.',
      },
      python: {
        type: 'string',
        inputType: 'textarea',
        description: 'For script (chat only): Python to run against the browser, with the browser-use helpers pre-imported.',
      },
      provider: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'For run in a workflow: which AI provider drives the agent. In chat the conversation’s provider is used.',
      },
      model: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'For run in a workflow: the model for the agent. In chat the conversation’s model is used.',
      },
      secrets: {
        type: 'string',
        inputType: 'textarea',
        description: 'For run: optional JSON map of placeholder → secret. The agent types the value but only ever sees the placeholder.',
      },
      externalWindow: {
        type: 'string',
        inputType: 'checkbox',
        options: ['true'],
        description: 'For run: open a separate, visible OS browser window. ONLY when the user explicitly asked for one.',
      },
      timeoutSeconds: {
        type: 'number',
        inputType: 'number',
        inputSize: 'half',
        description: 'For run/script: how long the step may take before it is stopped.',
      },
      browser: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'For script: launch a specific installed browser (chrome, brave, edge, chromium) instead of the widget.',
      },
    },
    outputs: {
      url: { type: 'string', description: 'Where the page is after the action' },
      title: { type: 'string', description: 'The page title after the action' },
      snapshot: { type: 'string', description: 'The accessibility tree with @refs (snapshot only)' },
      text: { type: 'string', description: 'The page text (read only)' },
      surface: { type: 'string', description: '"widget" for the canvas Browser widget, otherwise the launched browser' },
      result: { type: 'string', description: 'What the autonomous agent reported (run only)' },
      output: { type: 'string', description: 'What the script printed (script only)' },
      error: { type: 'string', description: 'Why the action could not be performed' },
    },
  };

  constructor() {
    super('browser');
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

    if (BROWSER_ACTIONS.includes(action)) {
      return actTool.execute(
        { ...Browser.paramsFor(actTool, params), action },
        inputData,
        workflowEngine,
      );
    }

    if (action === 'run') {
      if (!String(params?.instructions || '').trim()) {
        return this.formatOutput({
          success: false,
          error: 'action="run" hands the whole task to an autonomous agent, so it needs `instructions` — the task in plain English.',
        });
      }
      return useTool.execute(Browser.paramsFor(useTool, params), inputData, workflowEngine);
    }

    if (action === 'script') {
      if (!String(params?.python || '').trim()) {
        return this.formatOutput({
          success: false,
          error: 'action="script" needs `python` — the code to run against the browser.',
        });
      }
      // The chat-only gate lives in the engine's execute, where it has always
      // been, so it cannot be bypassed by calling the engine directly either.
      return controlTool.execute(Browser.paramsFor(controlTool, params), inputData, workflowEngine);
    }

    return this.formatOutput({
      success: false,
      error: `Unknown browser action "${action || '(none)'}". Verbs: ${BROWSER_ACTIONS.join(', ')}. `
        + 'Or: "run" with instructions for a whole autonomous task, "script" with python for raw control (chat only).',
    });
  }
}

export default new Browser();
