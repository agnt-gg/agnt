import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Nov 2026, bravo: a teammate was refused custom tools, the browser, AI widgets, data_transformer, the
// database step, plugins and MCP tools, mostly because those names had no capability profile and
// "unknown" meant "refuse". Unknown now means "sandboxed" wherever AGNT can sandbox it.
const hosted = vi.hoisted(() => ({ value: true }));
vi.mock('./toolRunAuthority.js', async (importOriginal) => ({ ...(await importOriginal()), hostedToolBoundaryRequired: () => hosted.value }));
const { memberRefusal } = await import('./memberIsolation.js');
const { resolveToolCapabilities } = await import('./toolCapabilities.js');
const { setMemberSafePluginTools } = await import('./memberSafePlugins.js');

beforeEach(() => {
  hosted.value = true;
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1'); vi.stubEnv('AGNT_TENANT_MEMBERS', 'owner-1,member-2');
  setMemberSafePluginTools([], ['magic-8-ball', 'calc-evaluate']);
});
afterEach(() => vi.unstubAllEnvs());
const allowed = (tool, args = {}) => memberRefusal(tool, args, 'member-2') === null;

describe('one tool, one profile, however it is spelled', () => {
  it('LLM names find their manifest profile', () => {
    expect(resolveToolCapabilities('data_transformer')).toEqual(resolveToolCapabilities('data-transformer'));
    expect(resolveToolCapabilities('execute_javascript').capabilities).toEqual(['code-eval']);
    expect(resolveToolCapabilities('file_system_operation', { operation: 'executeFile' }).capabilities).toContain('shell');
    expect(resolveToolCapabilities('constructor')).toBeNull();
    expect(resolveToolCapabilities('no_such_tool')).toBeNull();
  });
});

describe('a teammate on a hosted instance', () => {
  it.each(['data_transformer', 'generate_widget', 'create_goal', 'save_tool', 'run_tool', 'execute_custom_agnt_tool', 'execute_javascript', 'execute_python', 'database_operation', 'database-operation', 'browser', 'ai-browser-act', 'mcp_client', 'mcp__notion__search', 'magic-8-ball', 'calc_evaluate'])('may use %s (it runs sandboxed or isolated)', (tool) => {
    expect(allowed(tool)).toBe(true);
  });

  it('still may not use what holds the owner\'s own sign-ins or desktop, or an unknown in-process tool', () => {
    for (const tool of ['codex_exec', 'cursor_exec', 'grok_exec', 'computer_use', 'write_plugin_file', 'some_unknown_tool']) expect(allowed(tool), tool).toBe(false);
  });

  it('other SQL tools stay owner-only: only the isolated database step is opened', () => {
    expect(memberRefusal('sql_query_tool_x', {}, 'member-2')).not.toBeNull();
  });
});

describe('without the hosted sandbox (desktop, or a container without the launcher)', () => {
  it('plugins, MCP servers and the browser stay owner-only for a non-owner', () => {
    hosted.value = false;
    for (const tool of ['magic-8-ball', 'mcp__notion__search', 'browser']) expect(allowed(tool), tool).toBe(false);
  });

  it('the owner is never refused', () => {
    for (const tool of ['browser', 'codex_exec', 'some_unknown_tool']) expect(memberRefusal(tool, {}, 'owner-1')).toBeNull();
  });
});
