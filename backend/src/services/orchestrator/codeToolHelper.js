/**
 * The `agnt` helper every execute_javascript_code script starts with.
 *
 * `await agnt.tool(name, args)` runs any AGNT tool through the same
 * POST /api/tools/:name/execute route the rest of the app uses, so one script
 * can make many calls in a single model round (loops, Promise.all fan-out,
 * filtering a large result down) and print only what matters. Each call is
 * recorded under the run that started the script, and one script may make at
 * most AGNT_TOOL_CALL_LIMIT calls, so a runaway loop stops on its own.
 *
 * The source is collapsed onto a single line and placed on the wrapper's first
 * line, so line numbers in a script's own error messages do not move.
 */
export const AGNT_TOOL_CALL_LIMIT = 100;

/** Base URL of this backend's API, as scripts reach it. */
export function agntApiBase() {
  return process.env.AGNT_API_BASE || `http://localhost:${process.env.PORT || 3333}/api`;
}

const HELPER_SOURCE = `
const agnt = Object.freeze((() => {
  const base = process.env.AGNT_API_BASE;
  const parent = process.env.AGNT_PARENT_EXECUTION_ID || '';
  const limit = Number(process.env.AGNT_TOOL_CALL_LIMIT) || ${AGNT_TOOL_CALL_LIMIT};
  let calls = 0;
  async function tool(name, args = {}) {
    if (typeof name !== 'string' || !name) throw new TypeError('agnt.tool(name, args): name must be a tool name');
    if (name.replace(/-/g, '_') === 'execute_javascript_code') throw new Error('agnt.tool: execute_javascript_code cannot run inside a script; put that code in this script instead');
    if (!base) throw new Error('agnt.tool is not available in this runtime');
    calls += 1;
    if (calls > limit) throw new Error('agnt.tool: this script reached its limit of ' + limit + ' tool calls');
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.AGNT_AUTH_TOKEN) headers.Authorization = 'Bearer ' + process.env.AGNT_AUTH_TOKEN;
    if (parent) headers['X-AGNT-Parent-Execution'] = parent;
    const response = await fetch(base + '/tools/' + encodeURIComponent(name) + '/execute', { method: 'POST', headers, body: JSON.stringify({ args }) });
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok || !body || body.success === false) {
      const error = new Error('agnt.tool("' + name + '") failed: ' + ((body && body.error) || 'HTTP ' + response.status));
      error.tool = name;
      error.status = response.status;
      error.details = body ? body.details : undefined;
      throw error;
    }
    return body.result;
  }
  return { tool };
})());
`;

/** One line of JavaScript that defines `agnt` for the script after it. */
export const CODE_TOOL_HELPER = HELPER_SOURCE.trim().replace(/\s*\n\s*/g, ' ');
