import BaseAction from '../BaseAction.js';
import { spawn } from 'child_process';
import { waitForSurface, forgetSurfaceByUrl, isLocalBridgeUrl } from '../../../services/browserSurfaces.js';
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
 * The endpoint the shared daemon was last pointed at.
 *
 * browser-harness runs ONE default daemon per machine and it caches its CDP
 * connection, so `ensure_daemon` only self-heals when that connection is DEAD.
 * With two Browser widgets open the old endpoint is very much alive, the probe
 * passes, and the daemon keeps driving the window the user is not looking at —
 * the same cross-window bug browserSurfaces.js documents and defends against on
 * its own side. Endpoint drift is therefore detected here rather than inferred.
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
      + 'Helpers are pre-imported; print() what you want to see. '
      + 'Navigate with goto_url(url) then wait_for_load() — new_tab() is NOT available, because the widget '
      + 'hosts a single tab. Read the page with page_info(), js("expression"), or '
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
    },
    outputs: {
      output: { type: 'string', description: 'Everything the Python printed' },
      diagnostics: { type: 'string', description: 'Warnings the CLI wrote to stderr' },
      url: { type: 'string', description: 'The browser surface that was driven' },
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
      const cdpUrl = await this.resolveSurface(workflowEngine, userId);
      const cli = await ensureCli();
      await this.ensureDaemonTargets(cdpUrl);

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
      const lost = this.describeLostSurface(outcome.stderr, cdpUrl, userId);
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
   * The browser to drive — and ONLY ever a browser AGNT is rendering.
   *
   * REFUSING IS THE FEATURE. Left to itself, browser-harness scans for a
   * DevToolsActivePort and attaches to whatever Chrome the user happens to have
   * running: their real browser, with their real logged-in sessions. That is a
   * fine default for a coding CLI the user invoked in their own terminal. It is
   * not a defensible default for a tool a model can call on its own initiative,
   * so a missing widget is an error with an instruction, never a fallback.
   *
   * The Browser Agent can honestly fall back to launching its own Chromium
   * because that browser is a clean profile it owns. There is no equivalent
   * here: the CLI's fallback is somebody else's browser.
   */
  async resolveSurface(workflowEngine, userId, waitMs = 8000, probe = undefined) {
    const workspaceId = workflowEngine?.workspaceState?.id || null;
    const instanceId = workflowEngine?.workspaceState?.browserInstanceId || null;
    const surface = probe
      ? await waitForSurface(userId, { workspaceId, instanceId }, waitMs, 200, probe)
      : await waitForSurface(userId, { workspaceId, instanceId }, waitMs);

    if (!surface) {
      throw new Error(
        'There is no AGNT Browser widget open to drive. Open one on the workspace canvas and try again. '
        + '(Browser Control never attaches to your own Chrome — only to a browser AGNT is rendering.)',
      );
    }

    // Belt and braces: the registry only ever stores loopback bridge URLs, and
    // this is the last point before that string becomes an environment variable
    // for a subprocess. A non-local endpoint here would mean the registry itself
    // was wrong, which is worth failing loudly over rather than connecting to.
    if (!isLocalBridgeUrl(surface.cdpUrl)) {
      throw new Error(`Refusing to drive a non-local browser endpoint: ${surface.cdpUrl}`);
    }
    return surface.cdpUrl;
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
    if (daemonEndpoint === cdpUrl) return;

    if (daemonEndpoint !== null) {
      console.log('[Browser Control] browser surface changed; restarting the browser-use daemon.');
      const { python } = browserUsePaths();
      try {
        // restart_daemon() only stops; the next CLI call spawns a fresh daemon
        // through ensure_daemon() with the environment we hand it. It verifies
        // the daemon's identity over IPC before signalling anything, so a reused
        // pid is never killed.
        await runProcess(python, ['-c', 'from browser_harness import admin; admin.restart_daemon()']);
      } catch (err) {
        // Not fatal: a daemon we could not stop is one ensure_daemon will
        // probe, find pointed at a dead socket, and replace on its own.
        console.warn('[Browser Control] could not stop the previous daemon:', err.message);
      }
    }
    daemonEndpoint = cdpUrl;
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
  describeLostSurface(message, cdpUrl, userId) {
    const text = String(message || '');
    if (!/Failed to establish CDP connection|ECONNREFUSED|WinError 1225|refused the network connection|unreachable/i.test(text)) {
      return null;
    }
    forgetSurfaceByUrl(userId, cdpUrl);
    daemonEndpoint = null;
    return 'The Browser widget this step was driving is no longer open, so the connection was refused. '
      + 'It has been forgotten — run the step again and it will use the Browser widget that is open now.';
  }

  formatOutput(output) {
    const shaped = {
      success: output.success ?? false,
      output: output.output ?? '',
      diagnostics: output.diagnostics ?? null,
      url: output.url ?? null,
      error: output.error ?? null,
    };
    return { ...shaped, outputs: { ...shaped } };
  }
}

export default new AIBrowserControl();
