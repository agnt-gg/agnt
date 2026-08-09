import BaseAction from '../BaseAction.js';
import { spawn } from 'child_process';
import { createHash, randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import https from 'https';
import AuthManager from '../../../services/auth/AuthManager.js';
import PathManager from '../../../utils/PathManager.js';
import CustomOpenAIProviderService from '../../../services/ai/CustomOpenAIProviderService.js';
import { mintGatewayToken, revokeGatewayToken } from '../../../services/ai/localGatewayTokens.js';
import { waitForSurface } from '../../../services/browserSurfaces.js';
import {
  ROUTE,
  resolveBrowserUseProvider,
  customProviderRouting,
  browserUseProviderOptions,
  describeModelAvailabilityError,
} from './browserUseProviders.js';
import { RUNNER_PY, RUNNER_VERSION, RESULT_SENTINEL } from './browserUseRunner.js';

/**
 * The browser-use release this tool is written against.
 *
 * PINNED, AND THAT IS THE POINT. This tool used to install from
 * `git+https://github.com/browser-use/browser-use.git`, so every machine got
 * whatever `main` happened to be on the day its venv was created. Upstream then
 * removed `ChatGoogleGenerativeAI` when it dropped LangChain, and the Gemini
 * option in this node had been dead ever since — with no commit, no failing
 * test and no way to notice, because nothing here ever named a version.
 *
 * Bumping this constant is the whole upgrade procedure: the version check below
 * reinstalls when the venv disagrees.
 */
export const BROWSER_USE_VERSION = '0.13.7';

/**
 * Packages the runner needs that browser-use does not already pull in.
 *
 * Deliberately almost empty. The old list installed langchain, langchain_openai,
 * langchain_google_genai, selenium, webdriver_manager and playwright — none of
 * which 0.13.x uses; it dropped LangChain at 0.7 and Playwright for raw CDP.
 * Worse, its "is it installed?" check did `__import__(name.replace('-','_'))`,
 * which turned `python-dotenv` into `python_dotenv` and `beautifulsoup4` into
 * `beautifulsoup4` — neither of which is importable — so the check failed every
 * time and pip re-ran on EVERY browser task.
 */
const EXTRA_REQUIREMENTS = [];

/** Per-process memo so the environment check runs once, not once per task. */
let environmentReadyFor = null;

class AIBrowserUse extends BaseAction {
  static schema = {
    title: 'Browser Agent',
    category: 'action',
    type: 'ai-browser-use',
    icon: 'web',
    description: 'Runs a browser automation task with browser-use, driven by any connected AI provider.',
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
        description: 'Model to use. Leave blank for the provider\'s default vision model.',
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
        description: 'Run without a visible browser window.',
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
        cdpUrl: await this.resolveSurface(params, workflowEngine, userId),
      };
      const llm = await this.buildLlmSpec(resolved, userId);
      gatewayToken = llm.gatewayToken;
      providerLabel = llm.providerName;

      const config = this.buildRunnerConfig(resolved, instructions, llm);
      const pythonExecutable = await this.ensureEnvironment();
      const outcome = await this.runRunner(pythonExecutable, config, params);

      if (!outcome.success) {
        // A model the account cannot call is the most likely first failure and
        // the least self-explanatory, so name the fix rather than relaying a
        // raw vendor 400.
        const guidance = describeModelAvailabilityError(outcome.error, providerLabel);
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
   * Only the PROVIDER is inherited, never the model: the chat model is chosen
   * for conversation, and browser-use is a screenshot-driven agent. Letting
   * defaultModelFor pick keeps it on a vision-capable model.
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
   */
  async resolveSurface(params, workflowEngine, userId, waitMs = 8000) {
    const explicit = (params.cdpUrl || '').trim();
    if (explicit) return explicit;
    if (!this.isChatRun(workflowEngine)) return '';

    const surface = await waitForSurface(userId, waitMs);
    if (surface) return surface.cdpUrl;

    // No window to drive — chat outside a workspace, or the desktop app is not
    // hosting one. Launching is the honest fallback, not an error.
    console.log('[Browser Agent] no browser surface is open; launching one instead.');
    return '';
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

  // ── python environment ───────────────────────────────────────────────────

  /**
   * Ensure a venv exists with exactly BROWSER_USE_VERSION installed, and return
   * its interpreter. Memoised per process: the old code ran a full pip pass
   * before every single browser task.
   */
  async ensureEnvironment() {
    const workingDir = PathManager.getUserDataPath();
    const venvPath = path.join(workingDir, 'browser_use_venv');
    const isWindows = process.platform === 'win32';
    const venvPython = isWindows
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python');

    if (environmentReadyFor === BROWSER_USE_VERSION && fs.existsSync(venvPython)) return venvPython;

    await this.ensureVenv(workingDir, venvPath, venvPython);

    const installed = await this.installedBrowserUseVersion(venvPython);
    if (installed !== BROWSER_USE_VERSION) {
      console.log(`[Browser Agent] installing browser-use==${BROWSER_USE_VERSION} (found: ${installed || 'nothing'})`);
      await this.pipInstall(venvPython, [`browser-use==${BROWSER_USE_VERSION}`, ...EXTRA_REQUIREMENTS]);

      const confirmed = await this.installedBrowserUseVersion(venvPython);
      if (confirmed !== BROWSER_USE_VERSION) {
        throw new Error(
          `Installed browser-use ${confirmed || 'nothing'} but expected ${BROWSER_USE_VERSION}. `
          + 'Check the Python environment at ' + venvPath,
        );
      }
    }

    environmentReadyFor = BROWSER_USE_VERSION;
    return venvPython;
  }

  async installedBrowserUseVersion(venvPython) {
    const probe = 'import importlib.metadata as m;\nprint(m.version("browser-use"))';
    try {
      const { stdout } = await this.runProcess(venvPython, ['-c', probe]);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async pipInstall(venvPython, packages) {
    await this.runProcess(venvPython, ['-m', 'pip', 'install', '--upgrade', ...packages], { streamLogs: true });
  }

  async ensureVenv(workingDir, venvPath, venvPython) {
    if (fs.existsSync(venvPython)) {
      // A venv with no pip cannot install anything; repair it rather than
      // failing several steps later with a confusing error.
      try {
        await this.runProcess(venvPython, ['-m', 'pip', '--version']);
        return;
      } catch {
        await this.bootstrapPip(workingDir, venvPython);
        return;
      }
    }

    const systemPython = await this.findSystemPython();
    console.log(`[Browser Agent] creating Python environment with ${systemPython}`);
    try {
      await this.runProcess(systemPython, ['-m', 'venv', venvPath]);
    } catch (err) {
      // Debian and friends ship python3 without ensurepip.
      if (/ensurepip|python3-venv/i.test(err.message)) {
        await this.runProcess(systemPython, ['-m', 'venv', '--without-pip', venvPath]);
        await this.bootstrapPip(workingDir, venvPython);
        return;
      }
      throw new Error(
        `Could not create a Python environment for the browser agent: ${err.message}. `
        + 'browser-use needs Python 3.11 or newer on PATH.',
      );
    }

    try {
      await this.runProcess(venvPython, ['-m', 'pip', '--version']);
    } catch {
      await this.bootstrapPip(workingDir, venvPython);
    }
  }

  async bootstrapPip(workingDir, venvPython) {
    const getPipPath = path.join(workingDir, 'get-pip.py');
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(getPipPath);
      https.get('https://bootstrap.pypa.io/get-pip.py', (response) => {
        if (response.statusCode !== 200) {
          file.close();
          return reject(new Error(`Downloading get-pip.py returned HTTP ${response.statusCode}`));
        }
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        return undefined;
      }).on('error', (err) => {
        fs.unlink(getPipPath, () => {});
        reject(new Error(`Failed to download get-pip.py: ${err.message}`));
      });
    });

    try {
      await this.runProcess(venvPython, [getPipPath], { streamLogs: true });
    } finally {
      try { fs.unlinkSync(getPipPath); } catch { /* best effort */ }
    }
  }

  async findSystemPython() {
    const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
    for (const candidate of candidates) {
      try {
        await this.runProcess(candidate, ['--version']);
        return candidate;
      } catch { /* try the next one */ }
    }
    throw new Error('No Python interpreter found on PATH. browser-use needs Python 3.11 or newer.');
  }

  runProcess(command, args, { streamLogs = false } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (streamLogs) console.log('[Browser Agent setup]', chunk.toString().trimEnd());
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (streamLogs) console.error('[Browser Agent setup]', chunk.toString().trimEnd());
      });

      child.on('error', (err) => reject(new Error(`${command} could not be started: ${err.message}`)));
      child.on('close', (code) => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
      });
    });
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
