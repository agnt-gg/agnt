import BaseAction from '../BaseAction.js';
import { spawn } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import AuthManager from '../../../services/auth/AuthManager.js';
import PathManager from '../../../utils/PathManager.js';
import CustomOpenAIProviderService from '../../../services/ai/CustomOpenAIProviderService.js';
import { mintGatewayToken, revokeGatewayToken } from '../../../services/ai/localGatewayTokens.js';
import { waitForSurface, forgetSurfaceByUrl, announceHostSurface } from '../../../services/browserSurfaces.js';
import { ensureFallbackSurface, isLoopbackWebSocket } from './browserFallbackSurface.js';
import {
  ROUTE,
  resolveBrowserUseProvider,
  customProviderRouting,
  browserUseProviderOptions,
  describeModelAvailabilityError,
} from './browserUseProviders.js';
import { RUNNER_PY, RUNNER_VERSION, RESULT_SENTINEL } from './browserUseRunner.js';
import { ensureEnvironment, BROWSER_USE_VERSION } from './browserUseEnvironment.js';

/**
 * Re-exported so the Browser Agent still names its own dependency, and so the
 * schema test can assert the pin from the tool that uses it. The constant and
 * the code that installs it live together in browserUseEnvironment.js — the
 * thing that NAMES a version and the thing that INSTALLS it must not be able
 * to disagree. Bumping it there is still the whole upgrade procedure.
 */
export { BROWSER_USE_VERSION };

class AIBrowserUse extends BaseAction {
  static schema = {
    title: 'Browser Agent',
    category: 'action',
    type: 'ai-browser-use',
    icon: 'web',
    // THIS TEXT IS THE LLM'S ONLY INSTRUCTION MANUAL for the tool, so the
    // default is stated as a rule rather than left to be inferred. Without it a
    // model reaches for `externalWindow` whenever a task "feels" like it needs a
    // real browser, and the user watches an empty widget while the work happens
    // in a window they did not ask for.
    description: 'Hands a WHOLE browsing task to an autonomous nested agent (browser-use) that runs its own '
      + 'perceive-decide-act loop and reports back when finished — slow but self-sufficient, right for '
      + 'workflows and fire-and-forget jobs. For interactive browsing, PREFER the browser tool\'s verbs: '
      + 'far faster, and you stay in control between steps. ALWAYS drives the Browser widget inside AGNT — '
      + 'opening a hidden browser the widget can stream if none is there — and NEVER opens a visible OS '
      + 'window unless externalWindow is set, which requires the user explicitly asking for a separate, '
      + 'external or standalone browser window.',
    parameters: {
      instructions: {
        type: 'string',
        inputType: 'textarea',
        description: 'What the browser agent should do.',
      },
      provider: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        // Generated from providerConfigs, so this list cannot drift from what
        // the tool can actually run. It used to be a hand-written
        // ['OpenAI','Gemini','DeepSeek'] — two of which were broken.
        options: browserUseProviderOptions(),
        default: 'OpenAI',
        description: 'Which AI provider drives the browser.',
      },
      model: {
        type: 'string',
        inputType: 'text',
        inputSize: 'half',
        description: 'Model to use. Leave blank — chat turns inherit the conversation\'s own '
          + 'model (workspace setting, or the account default), and a workflow node falls back '
          + 'to the provider\'s default.',
      },
      maxSteps: {
        type: 'number',
        inputType: 'number',
        inputSize: 'half',
        default: 100,
        description: 'Maximum agent steps before giving up.',
      },
      timeoutMinutes: {
        type: 'number',
        inputType: 'number',
        inputSize: 'half',
        default: 15,
        description: 'Hard wall-clock limit for the whole run.',
      },
      useVision: {
        type: 'string',
        inputType: 'select',
        inputSize: 'half',
        options: ['auto', 'on', 'off'],
        default: 'auto',
        description: 'Send screenshots to the model. "auto" follows the provider\'s vision support.',
      },
      headless: {
        type: 'string',
        inputType: 'checkbox',
        options: ['true'],
        default: 'false',
        description: 'Run without a visible browser window. Applies only to an external window — '
          + 'the built-in Browser widget is on screen by definition.',
      },
      generateGif: {
        type: 'string',
        inputType: 'checkbox',
        options: ['true'],
        default: 'true',
        description: 'Record a GIF of the session.',
      },
      allowedDomains: {
        type: 'string',
        inputType: 'text',
        description: 'Comma-separated domains the agent may visit. Blank means no restriction.',
      },
      outputSchema: {
        type: 'string',
        inputType: 'textarea',
        description: 'Optional JSON Schema. When set, structuredOutput holds data matching it instead of prose.',
      },
      sensitiveData: {
        type: 'string',
        inputType: 'textarea',
        description: 'Optional JSON map of placeholder → secret. The agent types the value but only ever sees the placeholder.',
      },
      externalWindow: {
        type: 'string',
        inputType: 'checkbox',
        options: ['true'],
        default: 'false',
        description: 'Launch a SEPARATE browser window outside AGNT instead of using the built-in '
          + 'Browser widget. Leave this off by default. Only set it when the user explicitly asks for '
          + 'an external, separate or standalone browser — for example to keep a long task off the '
          + 'canvas, or to use a browser profile AGNT does not host.',
      },
      cdpUrl: {
        type: 'string',
        inputType: 'text',
        description: 'Optional. Drive an EXISTING browser over CDP instead of launching one. '
          + 'Chat turns resolve this automatically to the Browser widget on the canvas, so it is '
          + 'normally left blank. When set, headless and allowedDomains do not apply — the browser '
          + 'is not ours to configure.',
      },
    },
    outputs: {
      result: { type: 'string', description: 'The agent\'s final answer' },
      structuredOutput: { type: 'object', description: 'Parsed result when outputSchema is set' },
      isSuccessful: { type: 'boolean', description: 'The agent\'s own judgement of whether it completed the task' },
      urls: { type: 'array', description: 'Pages visited, in order' },
      steps: { type: 'number', description: 'How many steps the agent took' },
      agentErrors: { type: 'array', description: 'Errors the agent recovered from during the run' },
      gifPath: { type: 'string', description: 'Filename of the session recording' },
      error: { type: 'string', description: 'Why the run could not be completed' },
    },
  };

  constructor() {
    super('ai-browser-use');
  }

  async execute(params, inputData, workflowEngine) {
    const instructions = (params.instructions || '').trim();
    if (!instructions) {
      return this.formatOutput({ success: false, error: 'No instructions were provided for the browser agent.' });
    }

    const userId = workflowEngine?.userId;
    if (!userId) {
      return this.formatOutput({ success: false, error: 'Browser Agent could not identify the user for this run.' });
    }

    let gatewayToken = null;
    let providerLabel = params.provider || 'The provider';
    try {
      const resolved = {
        ...params,
        provider: this.resolveProvider(params, workflowEngine),
        model: this.resolveModel(params, workflowEngine),
        cdpUrl: await this.resolveSurface(params, workflowEngine, userId),
      };
      const llm = await this.buildLlmSpec(resolved, userId);
      gatewayToken = llm.gatewayToken;
      providerLabel = llm.providerName;

      const config = this.buildRunnerConfig(resolved, instructions, llm);
      const pythonExecutable = await ensureEnvironment();
      const outcome = await this.runRunner(pythonExecutable, config, params);

      if (!outcome.success) {
        // A model the account cannot call is the most likely first failure and
        // the least self-explanatory, so name the fix rather than relaying a
        // raw vendor 400.
        const guidance = describeModelAvailabilityError(outcome.error, providerLabel)
          || this.describeLostSurface(outcome.error, resolved.cdpUrl, userId);
        return this.formatOutput({
          success: false,
          error: guidance || outcome.error || 'The browser agent failed without reporting a reason.',
          gifPath: this.gifFilenameIfWritten(config.agent.generate_gif),
        });
      }

      return this.formatOutput({
        success: true,
        // The agent's answer, not a scrape of its logs. The previous version
        // discarded `await agent.run()` entirely and returned captured stdout —
        // banner art, progress bars and all — which is why every workflow using
        // this node had to pipe `result` into another LLM to find out what
        // actually happened.
        result: outcome.finalResult ?? '',
        structuredOutput: outcome.structuredOutput ?? null,
        isSuccessful: outcome.isSuccessful,
        urls: outcome.urls || [],
        steps: outcome.steps ?? 0,
        agentErrors: outcome.errors || [],
        gifPath: this.gifFilenameIfWritten(config.agent.generate_gif),
        error: null,
      });
    } catch (err) {
      console.error('[Browser Agent] run failed:', err);
      return this.formatOutput({ success: false, error: err.message || 'Unknown error occurred' });
    } finally {
      // Revoke before returning, always. A gateway grant outliving the process
      // it was minted for is exactly the leak the short TTL is a backstop for,
      // not a substitute for.
      if (gatewayToken) revokeGatewayToken(gatewayToken);
    }
  }

  // ── what a chat turn means ───────────────────────────────────────────

  /**
   * Was this run started by a conversation, or by a workflow?
   *
   * The orchestrator executes library actions with a stand-in engine built as
   * `{ userId, ...context }` (tools.js), so a chat turn arrives carrying the
   * conversation's own provider. A real WorkflowEngine has no such field. That
   * one difference is what separates "the user is watching this" from "this is
   * running in the background", and the two want opposite behaviour.
   */
  isChatRun(workflowEngine) {
    return Boolean(workflowEngine?.provider || workflowEngine?.normalizedProvider);
  }

  /**
   * Which provider drives the browser.
   *
   * From chat, the session's provider is AUTHORITATIVE and a model-supplied one
   * is ignored — the same rule analyze_image already enforces. The user picked a
   * provider for this workspace; an agent quietly running the browser on a
   * different one would spend credits they did not choose to spend.
   *
   * From a workflow node, the node's own dropdown wins, because that IS a user
   * choice and there is no conversation to inherit from.
   *
   * PROVIDER AND MODEL ARE BOTH INHERITED. The user selects nothing: whatever
   * the workspace is set to — or, when the workspace overrides nothing, the
   * account default — is what drives the browser, exactly as it drives the
   * conversation itself.
   */
  resolveProvider(params, workflowEngine) {
    if (!this.isChatRun(workflowEngine)) return params.provider || 'OpenAI';

    const session = workflowEngine.provider || workflowEngine.normalizedProvider;
    if (params.provider && params.provider !== session) {
      console.log(`[Browser Agent] ignoring requested provider "${params.provider}"; this conversation uses ${session}.`);
    }
    return session;
  }

  /**
   * Which model drives the browser — the session's, exactly as chosen.
   *
   * This used to substitute a vision default of the tool's own choosing, on the
   * reasoning that a chat model is picked for conversation while browser-use
   * reads screenshots. That reasoning is wrong for the same reason it is wrong
   * in analyze_image, which already carries the warning in its own source:
   * "Use the user's session model exactly as-is. We don't substitute
   * alternatives behind their back" — a substitution hides the real fix (change
   * the model in settings) behind behaviour nobody asked for and cannot see.
   *
   * So the session model wins, and a model the LLM asks for is ignored, for the
   * same reason the provider is. Blank only when the session has no model at
   * all (a workflow node with an empty field), where defaultModelFor supplies
   * the provider's own default rather than nothing.
   */
  resolveModel(params, workflowEngine) {
    if (!this.isChatRun(workflowEngine)) return params.model || '';

    const session = (workflowEngine.model || '').trim();
    if (!session) return params.model || '';

    if (params.model && params.model !== session) {
      console.log(`[Browser Agent] ignoring requested model "${params.model}"; this conversation uses ${session}.`);
    }
    return session;
  }

  /**
   * Which browser to drive.
   *
   * A chat turn drives the browser the user can SEE — the Browser widget on the
   * canvas — which is the whole point of that widget. Calling this tool also
   * auto-opens that widget, so the wait covers the race between this code and
   * the window mounting.
   *
   * A workflow node never adopts the visible browser. A background automation
   * seizing the window the user is reading, mid-scroll, is a worse failure than
   * launching its own.
   *
   * `externalWindow` is the one way to opt out, and it exists so the schema can
   * honestly say "unless the user asks for an external window". A rule in the
   * description with no lever behind it is just a sentence.
   */
  async resolveSurface(params, workflowEngine, userId, waitMs = 8000, probe = undefined) {
    // Checked FIRST, ahead of cdpUrl: "give me a separate window" is a human
    // instruction, while cdpUrl is plumbing. Honouring the plumbing over the
    // person would be the wrong way round — and the two only ever disagree
    // because someone asked for both.
    if (this.isTrue(params.externalWindow)) {
      if ((params.cdpUrl || '').trim()) {
        console.log('[Browser Agent] externalWindow was requested, so the supplied cdpUrl is ignored.');
      }
      return '';
    }

    const explicit = (params.cdpUrl || '').trim();
    if (explicit) return explicit;
    if (!this.isChatRun(workflowEngine)) return '';

    const workspaceId = workflowEngine?.workspaceState?.id || null;
    const instanceId = workflowEngine?.workspaceState?.browserInstanceId || null;
    const surface = probe
      ? await waitForSurface(userId, { workspaceId, instanceId }, waitMs, 200, probe)
      : await waitForSurface(userId, { workspaceId, instanceId }, waitMs);
    if (surface) return surface.cdpUrl;

    // No widget to drive. Returning '' here used to let browser-use launch its
    // OWN chromium — a surprise OS window over the user's desktop, reported as
    // a malfunction every single time it happened. Now the fallback is a
    // browser AGNT owns, launched HIDDEN and announced to the registry, so the
    // Browser widget streams it wherever the user is. A visible window is
    // opt-in via externalWindow, never a side effect.
    console.log(
      `[Browser Agent] no browser surface is open for ${instanceId || workspaceId || 'this chat'}; using a hidden browser.`,
    );
    const cdpUrl = await ensureFallbackSurface({ hidden: true, log: (m) => console.log(m) });
    if (!isLoopbackWebSocket(cdpUrl)) {
      throw new Error(`Refusing to drive a non-local browser endpoint: ${cdpUrl}`);
    }
    announceHostSurface(userId, cdpUrl, { workspaceId });
    return cdpUrl;
  }

  /**
   * Recognise "the browser we attached to is gone" and make the run recoverable.
   *
   * The registry probes before handing an endpoint out, so this is the narrow
   * race where a browser dies between the probe and the attach — a window closed
   * mid-turn, a renderer reloaded. Forgetting the surface here is what makes the
   * obvious next move ("try again") actually work, instead of failing on the
   * same refused socket forever.
   *
   * @returns {string|null} Guidance, or null when this is a different failure.
   */
  describeLostSurface(message, cdpUrl, userId) {
    const text = String(message || '');
    // ECONNREFUSED reads as WinError 1225 on Windows and ECONNREFUSED elsewhere;
    // browser-use wraps both in its own "Failed to establish CDP connection".
    if (!/Failed to establish CDP connection|ECONNREFUSED|WinError 1225|refused the network connection/i.test(text)) {
      return null;
    }
    if (!cdpUrl) return null;

    forgetSurfaceByUrl(userId, cdpUrl);
    return 'The browser window this task was driving is no longer open, so the connection was refused. '
      + 'It has been forgotten — run the task again and it will use the Browser widget that is open now, '
      + 'or open a fresh one.';
  }

  // ── provider → browser-use LLM spec ──────────────────────────────────────

  /**
   * Turn "the user picked Z.AI" into the class name and keyword arguments the
   * Python runner will construct, plus a gateway token when one is needed.
   */
  async buildLlmSpec(params, userId) {
    const requested = params.provider || 'OpenAI';

    // A custom provider is addressed by its UUID; it is OpenAI-compatible by
    // construction, which is the only kind AGNT's custom-provider system makes.
    if (await CustomOpenAIProviderService.isCustomProvider(requested)) {
      const credentials = await CustomOpenAIProviderService.getProviderCredentials(requested, userId);
      if (!credentials?.base_url) {
        throw new Error(`Custom provider "${requested}" is not connected, or has no stored base URL.`);
      }
      const routing = customProviderRouting(credentials.base_url, credentials.provider_name);
      // Custom providers store no default model — there is no catalogue to read
      // one from — so the node must name it rather than guess.
      if (!params.model) {
        throw new Error(`Set a model on the Browser Agent node: custom provider "${routing.name}" has no default.`);
      }
      return {
        gatewayToken: null,
        providerName: routing.name,
        visionCapable: routing.visionCapable,
        spec: {
          class: 'ChatOpenAI',
          kwargs: {
            model: params.model,
            // Local runtimes (Ollama, LM Studio, vLLM, Jan) legitimately have no
            // key; the OpenAI SDK still insists on a non-empty one.
            api_key: credentials.api_key || 'not-required',
            base_url: credentials.base_url,
          },
        },
      };
    }

    const routing = resolveBrowserUseProvider(requested);
    const model = params.model || routing.defaultModel;
    if (!model) {
      throw new Error(`Set a model on the Browser Agent node — ${routing.name} declares no default model.`);
    }

    if (routing.route === ROUTE.GATEWAY) {
      // No API key exists to hand over: these providers authenticate with a
      // refreshed OAuth session, a spoofed CLI user-agent or a local CLI
      // process. Point browser-use at our own OpenAI-compatible endpoint and
      // let the normal adapter path make the call.
      const { token } = mintGatewayToken({
        userId,
        provider: routing.key,
        model,
        ttlMs: Math.max(1, Number(params.timeoutMinutes) || 15) * 60 * 1000 + 60_000,
        label: `browser-agent:${routing.key}`,
      });
      const port = process.env.PORT || 3333;
      return {
        gatewayToken: token,
        providerName: routing.name,
        visionCapable: routing.visionCapable,
        spec: {
          class: 'ChatOpenAI',
          kwargs: { model, api_key: token, base_url: `http://127.0.0.1:${port}/api/llm/v1` },
        },
      };
    }

    const apiKey = await AuthManager.getValidAccessToken(userId, routing.key);
    if (!apiKey) {
      throw new Error(
        `${routing.name} is not connected. Add its API key in Settings → Providers, then run this node again.`,
      );
    }

    // Native classes already know their own base URL, and ours is not always
    // identical — providerConfigs lists DeepSeek as https://api.deepseek.com
    // while ChatDeepSeek defaults to .../v1. Passing ours would break it. Only
    // the OpenAI-compatible route needs an explicit endpoint.
    const kwargs = { model, api_key: apiKey, ...(routing.chatKwargs || {}) };
    if (routing.route === ROUTE.OPENAI_COMPAT) kwargs.base_url = routing.baseUrl;

    return {
      gatewayToken: null,
      providerName: routing.name,
      visionCapable: routing.visionCapable,
      spec: { class: routing.chatClass, kwargs },
    };
  }

  // ── runner configuration ─────────────────────────────────────────────────

  buildRunnerConfig(params, instructions, llm) {
    const useVision = this.resolveUseVision(params, llm.visionCapable);
    const gifPath = this.resolveGifPath(params);

    // An attached browser belongs to somebody else, so none of the launch-time
    // profile options apply to it. Sending them anyway would be a silent lie:
    // browser-use would accept `headless: true` for a browser that is visibly
    // on screen, and `allowed_domains` would not be enforced by a profile that
    // was never used to launch anything.
    const cdpUrl = (params.cdpUrl || '').trim() || null;
    const browser = {};
    if (!cdpUrl) {
      if (this.isTrue(params.headless)) browser.headless = true;
      const allowedDomains = (params.allowedDomains || '')
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      if (allowedDomains.length > 0) browser.allowed_domains = allowedDomains;
    }

    return {
      task: instructions,
      cdpUrl,
      llm: llm.spec,
      maxSteps: Math.max(1, Number(params.maxSteps) || 100),
      agent: {
        use_vision: useVision,
        generate_gif: gifPath,
      },
      browser,
      outputSchema: this.parseJsonParam(params.outputSchema, 'outputSchema'),
      sensitiveData: this.parseJsonParam(params.sensitiveData, 'sensitiveData'),
    };
  }

  resolveUseVision(params, providerSupportsVision) {
    const choice = (params.useVision || 'auto').toLowerCase();
    if (choice === 'on') return true;
    if (choice === 'off') return false;
    // 'auto' answers from the provider rather than defaulting to true. A
    // provider with no vision models — DeepSeek, MiniMax, Together — would
    // otherwise be sent screenshots it cannot see, and browser-use would keep
    // stepping on a blank mental picture instead of failing.
    return Boolean(providerSupportsVision);
  }

  /**
   * Where this run's GIF goes.
   *
   * An absolute, unique path passed straight to `generate_gif`. The previous
   * version let every run write `agent_history.gif` into the shared user-data
   * directory and renamed it afterwards, so two browser tasks running at once
   * overwrote each other's recording before either rename happened.
   */
  resolveGifPath(params) {
    // A GIF of an attached browser is a recording of the user's own window,
    // which they are already watching. Skip it rather than paying for frames
    // nobody will look at.
    if ((params.cdpUrl || '').trim()) return false;
    if (!this.isTrue(params.generateGif ?? 'true')) return false;
    const gifsDirectory = PathManager.getPath('media', 'gifs');
    fs.mkdirSync(gifsDirectory, { recursive: true });
    return path.join(gifsDirectory, `agent_history_${randomBytes(6).toString('hex')}.gif`);
  }

  gifFilenameIfWritten(gifPath) {
    if (typeof gifPath !== 'string') return null;
    return fs.existsSync(gifPath) ? path.basename(gifPath) : null;
  }

  parseJsonParam(raw, name) {
    if (!raw || !String(raw).trim()) return null;
    try {
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`${name} is not valid JSON: ${err.message}`);
    }
  }

  isTrue(value) {
    return value === true || value === 'true';
  }

  // ── running ──────────────────────────────────────────────────────────────

  async runRunner(pythonExecutable, config, params) {
    const workingDir = PathManager.getUserDataPath();
    const runnerPath = this.writeRunner(workingDir);
    const timeoutMs = Math.max(1, Number(params.timeoutMinutes) || 15) * 60 * 1000;

    // Round-trip so the child receives plain JSON with no undefined holes.
    const payload = JSON.parse(JSON.stringify(config));

    return new Promise((resolve, reject) => {
      const child = spawn(pythonExecutable, ['-u', runnerPath], {
        cwd: workingDir,
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
          // The user's browsing is their business. browser-use ships PostHog
          // telemetry and a cloud sync that are on by default.
          ANONYMIZED_TELEMETRY: 'false',
          BROWSER_USE_CLOUD_SYNC: 'false',
        },
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const killTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // SIGTERM lets browser-use close Chromium; if it will not go, take it.
        setTimeout(() => child.kill('SIGKILL'), 5000).unref?.();
      }, timeoutMs);

      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        console.log('[Browser Agent]', text.trimEnd());
      });
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        console.error('[Browser Agent]', text.trimEnd());
      });

      child.on('error', (err) => {
        clearTimeout(killTimer);
        reject(new Error(`Could not start the browser agent runner: ${err.message}`));
      });

      child.on('close', (code) => {
        clearTimeout(killTimer);

        if (timedOut) {
          return reject(new Error(
            `The browser agent hit its ${params.timeoutMinutes || 15}-minute limit and was stopped. `
            + 'Raise timeoutMinutes, lower maxSteps, or narrow the task.',
          ));
        }

        const result = this.parseResultLine(stdout);
        if (result) return resolve(result);

        return reject(new Error(
          stderr.trim()
          || `The browser agent exited with code ${code} without reporting a result.`,
        ));
      });

      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }

  /**
   * Pull the runner's one machine-readable line out of browser-use's logging.
   * Last one wins — the runner emits exactly one, and taking the last is
   * robust against a page that happens to print the sentinel.
   */
  parseResultLine(stdout) {
    const lines = stdout.split(/\r?\n/).filter((line) => line.startsWith(RESULT_SENTINEL));
    if (lines.length === 0) return null;
    try {
      return JSON.parse(lines[lines.length - 1].slice(RESULT_SENTINEL.length).trim());
    } catch {
      return null;
    }
  }

  /**
   * Write the runner next to the venv, but only when it would change. Keyed by
   * content hash so a partially-written or hand-edited copy is replaced.
   */
  writeRunner(workingDir) {
    const runnerPath = path.join(workingDir, `browser_use_runner_v${RUNNER_VERSION}.py`);
    const expected = createHash('sha256').update(RUNNER_PY).digest('hex');
    const stampPath = `${runnerPath}.sha256`;

    const current = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, 'utf8').trim() : null;
    if (current !== expected || !fs.existsSync(runnerPath)) {
      fs.writeFileSync(runnerPath, RUNNER_PY, 'utf8');
      fs.writeFileSync(stampPath, expected, 'utf8');
    }
    return runnerPath;
  }

  formatOutput(output) {
    const shaped = {
      success: output.success ?? false,
      result: output.result ?? null,
      structuredOutput: output.structuredOutput ?? null,
      isSuccessful: output.isSuccessful ?? null,
      urls: output.urls ?? [],
      steps: output.steps ?? 0,
      agentErrors: output.agentErrors ?? [],
      gifPath: output.gifPath ?? null,
      error: output.error ?? null,
    };
    return { ...shaped, outputs: { ...shaped } };
  }
}

export default new AIBrowserUse();
