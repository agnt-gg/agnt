/**
 * The wrapper around action="script", run in a REAL Python interpreter.
 *
 * browser-harness runs a step with a bare exec() and synchronous helpers, so
 * the scripts models actually write — `await navigate(...)`, `await
 * screenshot()` — died with "SyntaxError: 'await' outside function" before a
 * line ran. The helpers here are stubs with the harness's exact signatures and
 * synchronous behaviour; the thing under test is the wrapper, which only a
 * real interpreter can judge.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wrapBrowserScript } from './browserScriptPrelude.js';

/** A Python >= 3.8 (PyCF_ALLOW_TOP_LEVEL_AWAIT): the browser-use venv first, as production uses it. */
function findPython() {
  const candidates = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'AGNT', 'browser_use_venv', 'Scripts', 'python.exe'),
    'python3',
    'python',
  ].filter(Boolean);
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info >= (3, 8))'], { encoding: 'utf8' });
    if (probe.status === 0 && probe.stdout.trim() === 'True') return candidate;
  }
  return null;
}

const python = findPython();

/** Synchronous stand-ins with the harness's names and signatures. They record calls. */
const HARNESS_STUBS = String.raw`
import json, os
CALLS = []
PNG = b"\x89PNG\r\n\x1a\nstub"
def goto_url(url):
    CALLS.append(("goto_url", url)); return {"frameId": "F"}
def wait_for_load(timeout=15.0):
    CALLS.append(("wait_for_load",)); return True
def js(expression, target_id=None):
    CALLS.append(("js", expression)); return "js-result"
def capture_screenshot(path=None, full=False, max_dim=None):
    path = path or os.path.join(os.environ["STUB_TMP"], "shot.png")
    open(path, "wb").write(PNG); CALLS.append(("capture_screenshot", full)); return path
`;

let tmp;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-prelude-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

/** Run a model script the way the harness would: helpers in globals, then exec. */
function runScript(source, { extraStubs = '' } = {}) {
  const file = path.join(tmp, `step-${Math.random().toString(36).slice(2)}.py`);
  const program = `${HARNESS_STUBS}\n${extraStubs}\n${wrapBrowserScript(source)}\nprint("__CALLS__", json.dumps(CALLS))\n`;
  fs.writeFileSync(file, program, 'utf8');
  const result = spawnSync(python, [file], {
    encoding: 'utf8', env: { ...process.env, STUB_TMP: tmp, PYTHONIOENCODING: 'utf-8' }, timeout: 30000,
  });
  const callsLine = (result.stdout || '').split('\n').find((line) => line.startsWith('__CALLS__ '));
  return {
    status: result.status,
    stdout: (result.stdout || '').split('\n').filter((line) => !line.startsWith('__CALLS__ ')).join('\n').trim(),
    stderr: result.stderr || '',
    calls: callsLine ? JSON.parse(callsLine.slice('__CALLS__ '.length)) : null,
  };
}

// Each test starts a real Python, which runScript allows 30s; a cold interpreter
// under full-suite load took longer than vitest's 5s default. Same budget here.
describe.skipIf(!python)('scripts written the way models write them', { timeout: 60000 }, () => {
  it('runs the exact script that failed with "await outside function"', () => {
    const shotA = path.join(tmp, 'page.png').replace(/\\/g, '/');
    const shotB = path.join(tmp, 'grid.png').replace(/\\/g, '/');
    const script = [
      'import base64',
      "await navigate('https://agnt.gg/marketplace/daily-ai-news-research-and-email')",
      'await asyncio.sleep(0.01)',
      '# scroll the reach section into view and capture',
      "await evaluate(\"document.querySelector('ul.reach')?.closest('section')?.scrollIntoView({block:'start'})\")",
      'await asyncio.sleep(0.01)',
      'shot = await screenshot()',
      `open(r'${shotA}','wb').write(base64.b64decode(shot) if isinstance(shot,str) else shot)`,
      "await navigate('https://agnt.gg/marketplace/workflows')",
      'shot = await screenshot()',
      `open(r'${shotB}','wb').write(base64.b64decode(shot) if isinstance(shot,str) else shot)`,
      "print('ok')",
    ].join('\n');

    const run = runScript(script);

    expect(run.stderr).toBe('');
    expect(run.stdout).toBe('ok');
    expect(fs.readFileSync(shotA).subarray(0, 4).toString('latin1')).toBe('\x89PNG');
    expect(fs.readFileSync(shotB).subarray(0, 4).toString('latin1')).toBe('\x89PNG');
    // navigate = goto_url + wait_for_load, evaluate = js.
    expect(run.calls.map((c) => c[0])).toEqual([
      'goto_url', 'wait_for_load', 'js', 'capture_screenshot', 'goto_url', 'wait_for_load', 'capture_screenshot',
    ]);
  });

  it('runs plain synchronous scripts exactly as before', () => {
    const run = runScript("goto_url('https://example.com')\nwait_for_load()\nprint(js('document.title'))");
    expect(run.status).toBe(0);
    expect(run.stdout).toBe('js-result');
    expect(run.calls.map((c) => c[0])).toEqual(['goto_url', 'wait_for_load', 'js']);
  });

  it('supports async functions, awaits inside them, and gather', () => {
    const script = [
      'async def title_of(url):',
      '    await navigate(url)',
      "    return await evaluate('document.title')",
      "results = await asyncio.gather(title_of('https://a.test'), title_of('https://b.test'))",
      'print(results)',
    ].join('\n');
    const run = runScript(script);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe("['js-result', 'js-result']");
  });

  it('saves to a path when screenshot is given one, and returns that path', () => {
    const target = path.join(tmp, 'named.png').replace(/\\/g, '/');
    const run = runScript(`print(screenshot(r'${target}') == r'${target}')`);
    expect(run.stdout).toBe('True');
    expect(fs.existsSync(target)).toBe(true);
  });

  it('never replaces a helper the harness already defines', () => {
    const run = runScript("print(evaluate('x'))", { extraStubs: 'def evaluate(expression):\n    return "harness-own"' });
    expect(run.stdout).toBe('harness-own');
  });

  it('reports errors against the script\'s own line and text', () => {
    const run = runScript("print('first')\nx = 1\nundefined_helper()\n");
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe('first');
    expect(run.stderr).toMatch(/File "<script>", line 3/);
    expect(run.stderr).toMatch(/undefined_helper\(\)/);
    expect(run.stderr).toMatch(/NameError/);
  });

  it('carries quotes, backslashes, triple quotes and unicode through intact', () => {
    // U+2028 mid-string: String.prototype.trim() would strip it at an end.
    const script = String.raw`print("é \"q\" \u2028 \\ ''' 😀")`;
    const run = runScript(script);
    expect(run.stderr).toBe('');
    expect(run.stdout).toBe("é \"q\" \u2028 \\ ''' 😀");
  });
});

describe('the wrapper itself', () => {
  it('never embeds the raw script, so nothing in it can escape the wrapper', () => {
    const hostile = '")\nimport os; os.system("calc")\n_bh_run("';
    const wrapped = wrapBrowserScript(hostile);
    expect(wrapped).not.toContain(hostile);
    expect(wrapped).not.toContain('os.system');
  });
});
