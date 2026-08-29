/**
 * The one Python environment browser-use runs in, and who owns it.
 *
 * Extracted from ai-browser-use.js when a SECOND tool needed the same venv.
 * Two copies of venv bootstrapping would be two things to keep in step, and the
 * failure mode is silent: one tool upgrades the pin, the other keeps running the
 * old wheel out of the same directory and reports nothing.
 *
 * So the version, the packages, and the code that installs them live together.
 * `BROWSER_USE_VERSION` is here rather than in a tool because the thing that
 * NAMES a version and the thing that INSTALLS it should not be able to disagree.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import PathManager from '../../../utils/PathManager.js';

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
export const BROWSER_USE_VERSION = '0.13.8';

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

/**
 * The install currently in progress, if any.
 *
 * The memo above is only written AFTER the await chain finishes, so two callers
 * that arrive before it is set would both miss it and both run pip against the
 * same directory. That was unreachable while one tool owned this environment.
 * It is reachable now: two browser tools share the venv, and a single chat turn
 * can call both at once. Concurrent pip runs on one venv corrupt it in ways
 * that surface much later as a missing module.
 *
 * Holding the PROMISE rather than a boolean is what makes the second caller
 * wait for the first caller's install instead of starting its own.
 */
let environmentInFlight = null;

/**
 * Where the venv lives and what it contains.
 *
 * The CLI console script (`browser-use`) ships inside the same wheel as the
 * library, so both tools are served by one install — the CLI needs no separate
 * `uv tool install`, and no second copy of the dependency tree.
 */
export function browserUsePaths() {
  const workingDir = PathManager.getUserDataPath();
  const venvPath = path.join(workingDir, 'browser_use_venv');
  const isWindows = process.platform === 'win32';
  return {
    workingDir,
    venvPath,
    python: isWindows
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python'),
    cli: isWindows
      ? path.join(venvPath, 'Scripts', 'browser-use.exe')
      : path.join(venvPath, 'bin', 'browser-use'),
  };
}

/** Reset the memo. Test seam, and the way a failed install is retried. */
export function _resetEnvironmentMemo() {
  environmentReadyFor = null;
  environmentInFlight = null;
}

/**
 * Ensure a venv exists with exactly BROWSER_USE_VERSION installed, and return
 * its interpreter. Memoised per process: the old code ran a full pip pass
 * before every single browser task.
 */
export async function ensureEnvironment() {
  const { python } = browserUsePaths();

  if (environmentReadyFor === BROWSER_USE_VERSION && fs.existsSync(python)) return python;

  // Cleared when the install settles, so a FAILED install is retried by the
  // next caller rather than being memoised as a permanently broken promise.
  if (!environmentInFlight) {
    environmentInFlight = prepareEnvironment().finally(() => { environmentInFlight = null; });
  }
  return environmentInFlight;
}

async function prepareEnvironment() {
  const { workingDir, venvPath, python } = browserUsePaths();

  await ensureVenv(workingDir, venvPath, python);

  const installed = await installedBrowserUseVersion(python);
  if (installed !== BROWSER_USE_VERSION) {
    console.log(`[Browser Agent] installing browser-use==${BROWSER_USE_VERSION} (found: ${installed || 'nothing'})`);
    await pipInstall(python, [`browser-use==${BROWSER_USE_VERSION}`, ...EXTRA_REQUIREMENTS]);

    const confirmed = await installedBrowserUseVersion(python);
    if (confirmed !== BROWSER_USE_VERSION) {
      throw new Error(
        `Installed browser-use ${confirmed || 'nothing'} but expected ${BROWSER_USE_VERSION}. `
        + 'Check the Python environment at ' + venvPath,
      );
    }
  }

  environmentReadyFor = BROWSER_USE_VERSION;
  return python;
}

/**
 * Ensure the venv is ready and return the path to the browser-use CLI.
 *
 * Separate from ensureEnvironment because the CLI is a console script: pip
 * writes it at install time, and a venv that predates a repair could have the
 * library without the shim. Checking for the file itself — rather than assuming
 * it followed the package — is what turns "the CLI is missing" into a sentence
 * instead of ENOENT from a spawn several layers up.
 */
export async function ensureCli() {
  await ensureEnvironment();
  const { cli, venvPath } = browserUsePaths();
  if (!fs.existsSync(cli)) {
    throw new Error(
      `browser-use ${BROWSER_USE_VERSION} is installed but its command-line entry point is missing from ${venvPath}. `
      + 'Delete that directory and run a browser task again to rebuild it.',
    );
  }
  return cli;
}

async function installedBrowserUseVersion(venvPython) {
  const probe = 'import importlib.metadata as m;\nprint(m.version("browser-use"))';
  try {
    const { stdout } = await runProcess(venvPython, ['-c', probe]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function pipInstall(venvPython, packages) {
  await runProcess(venvPython, ['-m', 'pip', 'install', '--upgrade', ...packages], { streamLogs: true });
}

async function ensureVenv(workingDir, venvPath, venvPython) {
  if (fs.existsSync(venvPython)) {
    // A venv with no pip cannot install anything; repair it rather than
    // failing several steps later with a confusing error.
    try {
      await runProcess(venvPython, ['-m', 'pip', '--version']);
      return;
    } catch {
      await bootstrapPip(workingDir, venvPython);
      return;
    }
  }

  const systemPython = await findSystemPython();
  console.log(`[Browser Agent] creating Python environment with ${systemPython}`);
  try {
    await runProcess(systemPython, ['-m', 'venv', venvPath]);
  } catch (err) {
    // Debian and friends ship python3 without ensurepip.
    if (/ensurepip|python3-venv/i.test(err.message)) {
      await runProcess(systemPython, ['-m', 'venv', '--without-pip', venvPath]);
      await bootstrapPip(workingDir, venvPython);
      return;
    }
    throw new Error(
      `Could not create a Python environment for the browser agent: ${err.message}. `
      + 'browser-use needs Python 3.11 or newer on PATH.',
    );
  }

  try {
    await runProcess(venvPython, ['-m', 'pip', '--version']);
  } catch {
    await bootstrapPip(workingDir, venvPython);
  }
}

async function bootstrapPip(workingDir, venvPython) {
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
    await runProcess(venvPython, [getPipPath], { streamLogs: true });
  } finally {
    try { fs.unlinkSync(getPipPath); } catch { /* best effort */ }
  }
}

async function findSystemPython() {
  const candidates = process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python'];
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line no-await-in-loop -- probing in order; the
      // first interpreter that answers is the one we want.
      await runProcess(candidate, ['--version']);
      return candidate;
    } catch { /* try the next one */ }
  }
  throw new Error('No Python interpreter found on PATH. browser-use needs Python 3.11 or newer.');
}

export function runProcess(command, args, { streamLogs = false } = {}) {
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
