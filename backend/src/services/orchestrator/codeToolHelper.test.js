/**
 * agnt.tool() inside execute_javascript_code, end to end: the real tool spawns
 * a real script, and the script calls a local stand-in for the tools route.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';

const seen = [];
let inFlight = 0;
let maxInFlight = 0;
let server;
let base;
let TOOLS;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      const match = req.url.match(/^\/api\/tools\/([^/]+)\/execute$/);
      const name = match ? decodeURIComponent(match[1]) : null;
      const { args } = JSON.parse(body || '{}');
      seen.push({ name, args, authorization: req.headers.authorization, parent: req.headers['x-agnt-parent-execution'] });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, name === 'slow_tool' ? 150 : 0));
      inFlight -= 1;
      res.setHeader('content-type', 'application/json');
      if (name === 'broken_tool') return res.end(JSON.stringify({ success: false, tool: name, error: 'nope' }));
      return res.end(JSON.stringify({ success: true, tool: name, result: { echo: args } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  ({ TOOLS } = await import('./tools.js'));
}, 60_000);

afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  seen.length = 0;
  inFlight = 0;
  maxInFlight = 0;
  vi.stubEnv('AGNT_API_BASE', base);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function run(code, { token = 'Bearer test-token', context = { executionId: 'run-1' }, timeoutSeconds } = {}) {
  return JSON.parse(await TOOLS.execute_javascript_code.execute({ code, timeoutSeconds }, token, context));
}

describe('agnt.tool() inside execute_javascript_code', () => {
  it('runs a tool through the tools route and returns its result', async () => {
    const out = await run(`const r = await agnt.tool('echo_tool', { a: 1 }); console.log(JSON.stringify(r));`);
    expect(out.success).toBe(true);
    expect(JSON.parse(out.stdout)).toEqual({ echo: { a: 1 } });
    expect(seen).toEqual([{ name: 'echo_tool', args: { a: 1 }, authorization: 'Bearer test-token', parent: 'run-1' }]);
  });

  it('throws when the tool fails, and the script can handle it', async () => {
    const out = await run(`try { await agnt.tool('broken_tool'); } catch (e) { console.log(e.message); }`);
    expect(out.success).toBe(true);
    expect(out.stdout).toBe('agnt.tool("broken_tool") failed: nope');
  });

  it('runs calls concurrently from one script', async () => {
    const out = await run(`const rs = await Promise.all([1, 2, 3, 4].map((i) => agnt.tool('slow_tool', { i }))); console.log(rs.length);`);
    expect(out.stdout).toBe('4');
    expect(seen).toHaveLength(4);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('stops a script at its call limit', async () => {
    vi.stubEnv('AGNT_TOOL_CALL_LIMIT', '3');
    const out = await run(
      `for (let i = 0; i < 5; i++) { try { await agnt.tool('echo_tool', { i }); console.log('ok'); } catch (e) { console.log(e.message); } }`
    );
    const limit = 'agnt.tool: this script reached its limit of 3 tool calls';
    expect(out.stdout.split(/\r?\n/)).toEqual(['ok', 'ok', 'ok', limit, limit]);
    expect(seen).toHaveLength(3);
  });

  it('does not run execute_javascript_code from inside a script, by either spelling', async () => {
    const out = await run(
      `for (const name of ['execute_javascript_code', 'execute-javascript-code']) { try { await agnt.tool(name, { code: '1' }); } catch (e) { console.log(e.message); } }`
    );
    const lines = out.stdout.split(/\r?\n/);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toMatch(/cannot run inside a script/);
    expect(seen).toHaveLength(0);
  });

  it('names no parent run when the call has none', async () => {
    const out = await run(`await agnt.tool('echo_tool', {});`, { context: { userId: 'u1' } });
    expect(out.success).toBe(true);
    expect(seen[0].parent).toBeUndefined();
  });

  it("keeps the line numbers of the script's own errors", async () => {
    // Line 2 of the script is line 3 of the wrapper: one wrapper line, as before the helper.
    const out = await run(`const fine = 1;\nthrow new Error('boom');`);
    expect(out.success).toBe(false);
    expect(out.stderr).toMatch(/\[eval\]:3:/);
  });
});

describe('Stop', () => {
  it('ends a running script', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = run(`await new Promise((r) => setTimeout(r, 30000)); console.log('finished');`, {
      context: { executionId: 'run-1', abortSignal: controller.signal },
      timeoutSeconds: 60,
    });
    setTimeout(() => controller.abort(), 300);
    const out = await pending;
    expect(out.cancelled).toBe(true);
    expect(out.success).toBe(false);
    expect(out.stdout).not.toContain('finished');
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('does not start a script for a run that is already stopped', async () => {
    const controller = new AbortController();
    controller.abort();
    const out = await run(`console.log('ran');`, { context: { abortSignal: controller.signal } });
    expect(out).toEqual({ success: false, cancelled: true, error: 'Not run: the run was stopped.' });
  });
});
