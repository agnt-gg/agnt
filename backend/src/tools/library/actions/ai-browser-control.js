import BaseAction from '../BaseAction.js';
import { spawn } from 'child_process';
import {
  waitForSurface, forgetSurfaceByUrl, getActiveSurface, announceHostSurface, surfaceKind,
} from '../../../services/browserSurfaces.js';
import {
  ensureFallbackSurface, closeFallbackSurface, isLoopbackWebSocket, launchedBrowserLabel,
} from './browserFallbackSurface.js';
import { isCanvasTurn } from '../../../services/orchestrator/pageContext.js';
import { ensureCli, browserUsePaths, runProcess, BROWSER_USE_VERSION } from './browserUseEnvironment.js';

/**
 * Browser Control — the chat agent drives the browser itself.
 *
 * WHY THIS EXISTS ALONGSIDE THE BROWSER AGENT
 * -------------------------------------------
 * ai-browser-use spawns a SECOND agent: you hand it a sentence, it runs its own
 * perceive-decide-act loop with its own LLM, and returns when it is finished.
 * That is exactly right for a workflow node, where the task fires from a webhook
 * at 3am and there is nobody in the loop to do the reasoning.
 *
 * In chat there is already a loop — the conversation. The nested agent is then
 * pure overhead: the outer model cannot see the page, cannot course-correct
 * mid-task, and cannot interleave browser work with its other tools. It also
 * pays for a whole second model, which is why this tool needs no provider, no
 * model and no credentials at all: the reasoning is already happening upstairs.
 *
 * So this is not a replacement for the Browser Agent. It is the other half:
 *   chat, user watching       -> Browser Control (this)
 *   workflow, nobody watching -> Browser Agent (ai-browser-use)
 *
 * WHY IT IS CHAT-ONLY, AND WHY THAT IS ENFORCED TWICE
 * --------------------------------------------------
 * This runs Python that a model wrote. In a conversation that is the same trust
 * level as the code tools the orchestrator already has, with a human present.
 *
 * In a workflow it would be something else entirely. browserUseRunner.js exists
 * because its predecessor concatenated caller data into a `python -c` payload,
 * and the header of that file spells out why that was indefensible: node
 * parameters are templated from trigger data, so text arriving from Discord,
 * email or a webhook would become the program. A workflow node that executes
 * Python re-opens that exact door.
 *
 * Hence two independent gates, because the palette is advice and only the second
 * one is load-bearing:
 *   1. `chatOnly` keeps it out of the workflow node catalogue;
 *   2. execute() refuses a non-chat caller BY NAME — which is what actually
 *      stops a hand-written or LLM-generated workflow JSON naming the type.
 *
 * THE MEASURED CONSTRAINTS (browser-use 0.13.8 / browser-harness 0.1.9)
 * --------------------------------------------------------------------
 * Verified end to end against a faithful copy of electron/CdpBridge.js sitting
 * in front of a real page — the CLI navigated, read the accessibility tree and
 * computed click coordinates through AGNT's emulation, unmodified:
 *
 *   BU_CDP_WS, never BU_CDP_URL. `get_ws_url()` returns BU_CDP_WS verbatim,
 *     while BU_CDP_URL is an HTTP DevTools endpoint it resolves via
 *     /json/version. The Browser widget's bridge is a bare WebSocket and serves
 *     no HTTP at all, so BU_CDP_URL would block for 30s and then fail.
 *
 *   The DEFAULT daemon, never BU_NAME. A named daemon deliberately gives itself
 *     a dedicated tab via Target.createTarget, which the widget refuses because
 *     it hosts a single webview. The default daemon attaches to the page that is
 *     already there.
 *
 *   No new_tab(). Same refusal, and the reason the description below names
 *     goto_url() as the navigation primitive.
 */

/**
 * The endpoint THIS PROCESS has pointed the shared daemon at.
 *
 * browser-harness runs one default daemon per machine, it caches its CDP
 * connection, and a LIVE daemon never re-reads BU_CDP_WS — that variable is
 * only consumed by a daemon at spawn time. So handing the CLI a new endpoint
 * does nothing at all if a daemon is already running.
 *
 * `ensure_daemon` does not save us. Its health probe accepts any response to
 * `Target.getTargets` that contains a "result" key, and AN EMPTY TARGET LIST IS
 * A RESULT. A daemon bound to a bridge whose browser is long gone answers
 * `{targetInfos: []}` and is judged healthy, forever.
 *
 * MEASURED, not theorised: after an app restart this variable was null, the
 * daemon from the previous session was still alive and bound to a dead bridge,
 * and a navigation reported complete page_info() for a page that existed in no
 * visible window. The tool returned a true statement about a ghost.
 *
 * null therefore means "this process has not aimed the daemon", which is NOT
 * the same as "the daemon is fine" — it is the single most dangerous state,
 * because a surviving daemon is most likely to be stale right after a restart.
 */
let daemonEndpoint = null;

/** Test seam. */
export function _resetDaemonEndpoint() {
  daemonEndpoint = null;
}

/**
 * browser-harness prints an update banner to stderr once a day, and its second
 * line tells AGENTS to run `browser-harness --update -y`. Relaying that to a
 * model is how a pinned environment quietly stops being pinned — the exact
 * failure BROWSER_USE_VERSION exists to prevent. Dropped, not forwarded.
 */
export function stripHarnessNoise(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => !/^\[browser-harness\] (update available|agents: run)/.test(line))
    .join('\n')
    .trim();
}

class AIBrowserControl extends BaseAction {
  static schema = {
    title: 'Browser Control',
    category: 'action',
    type: 'ai-browser-control',
    icon: 'terminal',
    // Chat only. See the class comment: node parameters are templated from
    // trigger data, and this parameter is a program.
    chatOnly: true,
    description: 'Drive the AGNT Browser widget DIRECTLY by running Python in it, one step at a time, '
      + 'and read the result back. Use this when YOU want to look at a page and decide what to do next — '
      + 'it has no nested agent, so you stay in control between steps. Use ai_browser_use instead when a '
      + 'whole task should be handed off and completed autonomously. '
      + 'A browser is always available: it drives the Browser widget on the canvas, and opens a clean '
      + 'browser of its own if no widget is there — so never ask the user to open one. '
      + 'Helpers are pre-imported; print() what you want to see. '
      + 'Navigate with goto_url(url) then wait_for_load() — use goto_url, NOT new_tab(), which the '
      + 'single-tab widget refuses. Read the page with page_info(), js("expression"), or '
      + 'cdp("Accessibility.getFullAXTree")["nodes"] to find elements by role and name. To click: take the '
      + 'element\'s backendDOMNodeId, get its box with cdp("DOM.getBoxModel", backendNodeId=id)["model"]["content"], '
      + 'then click_at_xy(x, y) at the centre. Always wait_for_load() after navigating, or page reads race the '
      + 'new document and fail.',
    parameters: {
      python: {
        type: 'string',
        inputType: 'textarea',
        description: 'Python to run against the browser. Helpers are pre-imported: goto_url, wait_for_load, '
          + 'page_info, js, click_at_xy, type_text, scroll, screenshot, ensure_real_tab, cdp. '
          + 'Only what you print() comes back.',
      },
      timeoutSeconds: {
        type: 'number',
        inputType: 'number',
        inputSize: 'half',
        default: 120,
        description: 'Hard limit for this one step. Keep steps short and call the tool again.',
      },
      browser: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'Only set this when the user NAMES a browser ("open Brave and..."). '
          + 'One of: chrome, brave, edge, vivaldi, opera, chromium — or an absolute path to the '
          + 'executable. Leave blank to use the Browser widget on the canvas, which is the default '
          + 'and what you want almost always. Naming a browser opens a separate window instead.',
      },
    },
    outputs: {
      output: { type: 'string', description: 'Everything the Python printed' },
      diagnostics: { type: 'string', description: 'Warnings the CLI wrote to stderr' },
      url: { type: 'string', description: 'The browser surface that was driven' },
      surface: { type: 'string', description: '"widget" for the canvas Browser widget, otherwise the name of the browser AGNT launched (e.g. "Brave")' },
      error: { type: 'string', description: 'Why the step could not be run' },
    },
  };

  constructor() {
    super('ai-browser-control');
  }

  async execute(params, inputData, workflowEngine) {
    const python = (params.python || '').trim();
    if (!python) {
      return this.formatOutput({ success: false, error: 'No Python was provided for the browser step.' });
    }

    // GATE 1 of 2. The catalogue hides this tool from the workflow canvas; this
    // is the gate that actually holds, because a workflow JSON can name a node
    // type the palette never offered.
    if (!this.isChatRun(workflowEngine)) {
      return this.formatOutput({
        success: false,
        error: 'Browser Control only runs in a conversation, where a person is present and the Python comes '
          + 'from the assistant rather than from trigger data. Use the Browser Agent node (ai-browser-use) '
          + 'in a workflow: it takes an instruction in plain English and runs the browser itself.',
      });
    }

    const userId = workflowEngine?.userId;
    if (!userId) {
      return this.formatOutput({ success: false, error: 'Browser Control could not identify the user for this run.' });
    }

    try {
      const { cdpUrl, kind } = await this.resolveSurface(
        workflowEngine, userId, 8000, undefined, params.browser,
      );
      const cli = await ensureCli();
      if (await this.ensureDaemonTargets(cdpUrl)) {
        await this.verifyDaemonSurface(cli, cdpUrl);
      }

      const outcome = await this.runStep(cli, python, cdpUrl, params);

      if (outcome.timedOut) {
        return this.formatOutput({
          success: false,
          url: cdpUrl,
          output: outcome.stdout,
          error: `The browser step hit its ${this.timeoutSeconds(params)}-second limit. `
            + 'Break the work into smaller steps, or raise timeoutSeconds.',
        });
      }

      // A dead bridge here is the narrow race where the widget closed between
      // the registry's probe and this spawn. Forgetting it is what makes the
      // obvious next move — run it again — actually work.
      const lost = this.describeLostSurface(outcome.stderr, cdpUrl, userId, kind);
      if (lost) return this.formatOutput({ success: false, url: cdpUrl, output: outcome.stdout, error: lost });

      if (outcome.code !== 0) {
        return this.formatOutput({
          success: false,
          url: cdpUrl,
          output: outcome.stdout,
          diagnostics: outcome.stderr,
          error: outcome.stderr || `The browser step exited with code ${outcome.code}.`,
        });
      }

      return this.formatOutput({
        success: true,
        url: cdpUrl,
        surface: kind === 'launched' ? (launchedBrowserLabel() || 'launched') : kind,
        output: outcome.stdout,
        diagnostics: outcome.stderr || null,
        error: null,
      });
    } catch (err) {
      console.error('[Browser Control] step failed:', err);
      return this.formatOutput({ success: false, error: err.message || 'Unknown error occurred' });
    }
  }

  /**
   * Was this run started by a conversation, or by a workflow?
   *
   * Same test the Browser Agent uses: the orchestrator executes library actions
   * with a stand-in engine carrying the conversation's provider, and a real
   * WorkflowEngine has no such field.
   */
  isChatRun(workflowEngine) {
    return Boolean(workflowEngine?.provider || workflowEngine?.normalizedProvider);
  }

  /**
   * The browser to drive: the widget when there is one, otherwise one we open.
   *
   * THE ORDER MATTERS, AND THE FALLBACK IS NOT THE USER'S BROWSER.
   *
   * The widget is strongly preferred: it sits on the canvas beside the
   * conversation, so the work is visible where the user is already looking. It
   * is given a real chance to appear, because the frontend opens one
   * automatically on the first call and a freshly-mounted webview needs a
   * moment before its bridge exists.
   *
   * When there is genuinely no widget to drive, this launches a browser AGNT
   * OWNS — a clean profile, no cookies, no sessions, a port we chose. What it
   * must never do is what browser-harness does when left alone: find a
   * DevToolsActivePort and attach to whatever Chrome the user happens to have
   * open, carrying their logged-in sessions.
   *
   * An earlier version refused instead of launching, reasoning that any
   * fallback meant somebody else's browser. That conflated "do not touch the
   * user's browser" with "do not open one", and made the tool fail for a reason
   * the user could do nothing useful about — including during the few seconds
   * after a widget opens but before its bridge exists.
   *
   * @returns {{ cdpUrl: string, kind: 'widget'|'launched' }}
   */
  async resolveSurface(workflowEngine, userId, waitMs = 8000, probe = undefined, browser = '') {
    const workspaceId = workflowEngine?.workspaceState?.id || null;
    const instanceId = workflowEngine?.workspaceState?.browserInstanceId || null;

    // A NAMED BROWSER SKIPS THE WIDGET ENTIRELY.
    //
    // The widget is an Electron surface; it is not Brave, and it cannot become
    // Brave. So "open Brave and go to X" cannot be satisfied by the widget at
    // all, and quietly using it anyway would answer a different question than
    // the one asked. Same precedent as the Browser Agent's externalWindow: an
    // explicit human instruction outranks the convenient default.
    if (String(browser || '').trim()) {
      const named = await ensureFallbackSurface({ browser, log: (m) => console.log(m) });
      if (!isLoopbackWebSocket(named)) {
        throw new Error(`Refusing to drive a non-local browser endpoint: ${named}`);
      }
      // Announced even though it is a separate OS window: on a machine with no
      // display there IS no window, and a client that cannot see one still
      // needs a way to watch. Announcing costs nothing when nobody subscribes.
      announceHostSurface(userId, named, { workspaceId });
      return { cdpUrl: named, kind: 'launched' };
    }

    const findWidget = (ms) => (probe
      ? waitForSurface(userId, { workspaceId, instanceId }, ms, 200, probe)
      : waitForSurface(userId, { workspaceId, instanceId }, ms));

    // HOW LONG IS IT WORTH WAITING FOR A WIDGET TO APPEAR?
    //
    // The wait exists because a canvas turn RACES the widget it just opened:
    // TOOL_WIDGET_MAP mounts a Browser widget the moment this tool is called,
    // and the backend arrives here while that webview is still attaching its
    // debugger and minting a bridge. Without the wait, the first "go look at X"
    // of a session would always miss the window it had just asked for.
    //
    // Main chat has no canvas. TOOL_WIDGET_MAP lives in the Workspace screen
    // and nowhere else, so no widget can EVER appear there and the wait is pure
    // latency on every single call — eight seconds of nothing before the
    // browser it was always going to launch.
    //
    // The exception is a surface the registry already knows: a workspace open
    // in another window, which a turn that is not workspace-bound may
    // legitimately drive. That one is worth waiting for.
    const canvasTurn = isCanvasTurn(workflowEngine);
    const registryKnowsOne = Boolean(getActiveSurface(userId, { workspaceId, instanceId }));
    const appearWait = canvasTurn || registryKnowsOne ? waitMs : 0;

    let surface = await findWidget(appearWait);

    // The registry believing in a widget that did not answer means one IS on
    // screen with a dropped bridge. That repairs itself on the widget's own
    // heartbeat, and waiting a little is far better than opening a second
    // browser window beside the one the user is already watching.
    if (!surface && getActiveSurface(userId, { workspaceId, instanceId })) {
      console.log('[Browser Control] a Browser widget is registered but unreachable; waiting for it to recover.');
      surface = await findWidget(Math.max(waitMs, 12000));
    }

    if (surface) {
      // Belt and braces: the registry only ever stores loopback bridge URLs, and
      // this is the last point before that string becomes an environment
      // variable for a subprocess. A non-local endpoint here would mean the
      // registry itself was wrong, which is worth failing loudly over.
      // isLoopbackWebSocket, NOT the bridge-shaped isLocalBridgeUrl. The
      // registry holds two shapes now: an Electron bridge
      // (ws://127.0.0.1:PORT/token) and a browser AGNT launched
      // (ws://127.0.0.1:PORT/devtools/browser/<uuid>), because launched
      // browsers announce themselves so the widget can stream them. The
      // bridge regex rejects the slashes in the second form, so this refused
      // a perfectly local browser it had opened itself \u2014 reported live as
      // "Refusing to drive a non-local browser endpoint: ws://127.0.0.1:...".
      // Loopback is the property this guard actually exists to enforce.
      if (!isLoopbackWebSocket(surface.cdpUrl)) {
        throw new Error(`Refusing to drive a non-local browser endpoint: ${surface.cdpUrl}`);
      }
      return { cdpUrl: surface.cdpUrl, kind: surfaceKind(surface) };
    }

    const cdpUrl = await ensureFallbackSurface({ log: (m) => console.log(m) });
    // The launched browser picks its own port, so this is a different shape from
    // a widget bridge — but it must still be loopback, for the same reason.
    if (!isLoopbackWebSocket(cdpUrl)) {
      throw new Error(`Refusing to drive a non-local browser endpoint: ${cdpUrl}`);
    }
    // THIS IS THE LINE THAT MAKES THE WEB CLIENT WORK.
    //
    // Without it, a browser tab reached exactly this point — no <webview>, so no
    // widget, so a launched browser — and the work happened on the host with no
    // way to see it. The registry entry is what a viewer subscribes to.
    announceHostSurface(userId, cdpUrl, { workspaceId });
    return { cdpUrl, kind: 'launched' };
  }

  /**
   * Point the shared daemon at THIS surface, restarting it when it is aimed
   * somewhere else.
   *
   * `ensure_daemon` already self-heals a daemon whose CDP connection is dead. It
   * cannot help when the old connection is healthy and simply belongs to a
   * different window, because from the daemon's point of view nothing is wrong.
   */
  async ensureDaemonTargets(cdpUrl) {
    if (daemonEndpoint === cdpUrl) return false;

    // Restart on the FIRST call too. The previous version skipped this when
    // daemonEndpoint was null, reasoning that there was nothing of ours to
    // replace — but the daemon is a detached OS process that outlives the
    // backend, so "we have not aimed it yet" is exactly when it is most likely
    // to be aimed somewhere stale. Only a daemon we SPAWNED with this
    // BU_CDP_WS can be trusted to be driving this surface.
    //
    // Cost is one extra spawn per backend start. The alternative cost is
    // silently driving a window nobody is looking at.
    console.log(`[Browser Control] pointing the browser-use daemon at ${cdpUrl}`);
    const { python } = browserUsePaths();
    try {
      // restart_daemon() only stops; the next CLI call spawns a fresh daemon
      // through ensure_daemon() with the environment we hand it. It verifies
      // the daemon's identity over IPC before signalling anything, so a reused
      // pid is never killed.
      await runProcess(python, ['-c', 'from browser_harness import admin; admin.restart_daemon()']);
    } catch (err) {
      // Not fatal on its own — the preflight below is what actually proves the
      // daemon is driving this surface.
      console.warn('[Browser Control] could not stop the previous daemon:', err.message);
    }
    daemonEndpoint = cdpUrl;
    return true;
  }

  /**
   * Prove the daemon can see the surface before running the user's program.
   *
   * This is the check that would have caught the ghost-navigation bug. A daemon
   * bound to a dead bridge reports zero targets and upstream calls that healthy;
   * running Python against it produces confident output about a page in no
   * visible window, which is worse than any error.
   *
   * Only runs when the endpoint changed, so the steady-state cost is nothing.
   */
  async verifyDaemonSurface(cli, cdpUrl) {
    const probe = 'print("__AGNT_TARGETS__", len(cdp("Target.getTargets")["targetInfos"]))';
    const outcome = await this.runStep(cli, probe, cdpUrl, { timeoutSeconds: 45 });
    const seen = /__AGNT_TARGETS__\s+(\d+)/.exec(outcome.stdout || '');

    if (!seen || Number(seen[1]) === 0) {
      // Force the next call to re-aim rather than inheriting this bad state.
      daemonEndpoint = null;
      throw new Error(
        'The browser-use daemon connected but cannot see the Browser widget, so the step was not run. '
        + 'This usually means the widget was reloaded and its bridge was replaced. '
        + 'Close and reopen the Browser widget, then try again.'
        + (outcome.stderr ? ` (${outcome.stderr.split('\n')[0]})` : ''),
      );
    }
  }

  timeoutSeconds(params) {
    return Math.max(1, Number(params.timeoutSeconds) || 120);
  }

  runStep(cli, python, cdpUrl, params) {
    const timeoutMs = this.timeoutSeconds(params) * 1000;

    return new Promise((resolve, reject) => {
      const child = spawn(cli, [], {
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          BU_CDP_WS: cdpUrl,
          // Cleared, not merely overridden. An inherited BU_NAME would give us a
          // NAMED daemon, which creates its own tab via Target.createTarget and
          // dies against the widget's single-tab surface; an inherited
          // BU_CDP_URL is an HTTP endpoint the widget does not serve. Both are
          // plausible leftovers in a developer's shell, and both fail in ways
          // that look nothing like their cause.
          BU_NAME: undefined,
          BU_CDP_URL: undefined,
          // The user's browsing is their business.
          ANONYMIZED_TELEMETRY: 'false',
          BROWSER_USE_CLOUD_SYNC: 'false',
          // Off unless the user asks: recordings write video to disk, and
          // domain skills silently change how pages are approached.
          BH_RECORD: '0',
          BH_DOMAIN_SKILLS: '0',
        },
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const killTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 3000).unref?.();
      }, timeoutMs);

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('error', (err) => {
        clearTimeout(killTimer);
        reject(new Error(`Could not start the browser-use CLI (browser-use ${BROWSER_USE_VERSION}): ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(killTimer);
        resolve({
          code,
          timedOut,
          stdout: stdout.trim(),
          stderr: stripHarnessNoise(stderr),
        });
      });

      child.stdin.on('error', () => { /* the child may die before we finish writing */ });
      child.stdin.write(python);
      child.stdin.end();
    });
  }

  /** @returns {string|null} Guidance, or null when this is a different failure. */
  describeLostSurface(message, cdpUrl, userId, kind = 'widget') {
    const text = String(message || '');
    if (!/Failed to establish CDP connection|ECONNREFUSED|WinError 1225|refused the network connection|unreachable/i.test(text)) {
      return null;
    }
    daemonEndpoint = null;

    if (kind === 'launched') {
      // Ours to clean up. Dropping it is what makes the next call open a fresh
      // one instead of retrying a browser the user has already closed.
      closeFallbackSurface();
      return 'The browser this step was driving has closed. Run the step again and a new one will open.';
    }

    forgetSurfaceByUrl(userId, cdpUrl);
    return 'The Browser widget this step was driving is no longer open, so the connection was refused. '
      + 'It has been forgotten — run the step again and it will use whichever browser is available now.';
  }

  formatOutput(output) {
    const shaped = {
      success: output.success ?? false,
      output: output.output ?? '',
      diagnostics: output.diagnostics ?? null,
      url: output.url ?? null,
      // 'widget' or 'launched', so the assistant can say WHICH browser it drove
      // rather than leaving the user wondering where a window came from.
      surface: output.surface ?? null,
      error: output.error ?? null,
    };
    return { ...shaped, outputs: { ...shaped } };
  }
}

export default new AIBrowserControl();
