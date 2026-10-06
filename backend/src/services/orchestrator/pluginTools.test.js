/**
 * Plugin Forge tools.
 *
 * The chat these replace sent every message to a whole-plugin regenerator, so
 * "does it need an API key?" rewrote the plugin and bumped its version. The
 * properties pinned here are what make the new chat safe to talk to:
 *   - nothing touches a draft unless asked; generation refuses a non-empty one
 *   - edits are surgical and atomic (a bad edit changes nothing)
 *   - file names cannot leave the plugin directory
 *   - install/test go through the app's own authenticated routes, and a test
 *     never runs code that differs from the draft
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const generatePlugin = vi.fn();
vi.mock('../PluginGenerator.js', () => ({
  default: class {
    generatePlugin(...args) {
      return generatePlugin(...args);
    }
  },
}));

import { getPluginToolSchemas, executePluginTool, isSafePluginFileName, canonicalJson } from './pluginTools.js';
import { TOOL_GROUPS } from './toolSelector.js';
import { detectChatType } from './chatConfigs.js';
import { fuzzyFind } from './fuzzyFind.js';
import { formatPluginDraft } from './system-prompts/plugin-forge-chat.js';

const AUTH = 'Bearer test-token';
const MANIFEST = {
  name: 'notion-sync',
  version: '1.0.0',
  tools: [{ type: 'notion-search', entryPoint: './search.js', schema: { title: 'Search', parameters: { query: { type: 'string' } } } }],
};

function draft(overrides = {}) {
  return {
    name: 'notion-sync',
    installState: 'draft',
    files: {
      'manifest.json': JSON.stringify(MANIFEST, null, 2),
      'search.js': "export default { async execute() { return { success: true }; } };\n",
    },
    ...overrides,
  };
}

const ctx = (pluginState, extra = {}) => ({ userId: 'u1', provider: 'anthropic', model: 'claude-test', pluginState, ...extra });
const run = async (name, args, context, token = AUTH) => JSON.parse(await executePluginTool(name, args, token, context));

/** fetch stub: a route table of `${METHOD} ${path}` → { status, body } (or a function of the request). */
let routes;
let calls;
beforeEach(() => {
  routes = {};
  calls = [];
  generatePlugin.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = String(url).replace(/^http:\/\/localhost:\d+\/api/, '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, auth: init.headers?.Authorization });
    const route = routes[`${method} ${path}`];
    const reply = typeof route === 'function' ? route(body) : route || { status: 404, body: { success: false, error: 'not found' } };
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('registration', () => {
  it('every schema is in the plugin_authoring group, so the Forge chat can call it', () => {
    const names = getPluginToolSchemas().map((s) => s.function.name);
    expect(names).toEqual(['generate_plugin', 'edit_plugin_file', 'write_plugin_file', 'delete_plugin_file', 'install_plugin', 'test_plugin_tool', 'load_plugin']);
    for (const name of names) expect(TOOL_GROUPS.plugin_authoring).toContain(name);
  });

  it('a Plugin Forge turn is the plugin surface, but a canvas turn stays the orchestrator', () => {
    expect(detectChatType({ path: '/chat', body: { pluginState: { files: {} } } })).toBe('plugin');
    expect(detectChatType({ path: '/chat', body: { pluginContext: { name: 'x' } } })).toBe('plugin');
    expect(detectChatType({ path: '/chat', body: { workspaceState: { id: 'ws' }, pluginState: {} } })).toBe('orchestrator');
  });
});

describe('outside Plugin Forge', () => {
  it('draft tools refuse and say where to go, instead of pretending to work', async () => {
    for (const [name, args] of [
      ['generate_plugin', { description: 'x' }],
      ['edit_plugin_file', { file: 'a.js', edits: [{ search: 'a', replace: 'b' }] }],
      ['write_plugin_file', { file: 'a.js', content: '' }],
      ['delete_plugin_file', { file: 'a.js' }],
      ['install_plugin', {}],
      ['load_plugin', { name: 'notion-sync' }],
    ]) {
      const result = await run(name, args, { userId: 'u1' });
      expect(result.success, name).toBe(false);
      expect(result.error, name).toContain('/plugin-forge');
    }
    expect(calls).toEqual([]);
  });
});

describe('generate_plugin', () => {
  it('fills an empty draft and reports the files to the page', async () => {
    generatePlugin.mockResolvedValue({
      manifest: MANIFEST,
      toolCode: { 'search.js': 'export default {}' },
      packageJson: { name: 'notion-sync', type: 'module', dependencies: {} },
    });
    const state = { files: {}, installState: 'none' };

    const result = await run('generate_plugin', { description: 'Search Notion' }, ctx(state));

    expect(result.success).toBe(true);
    expect(generatePlugin).toHaveBeenCalledWith('Search Notion', 'anthropic', 'claude-test');
    expect(Object.keys(state.files)).toEqual(['manifest.json', 'search.js', 'package.json']);
    expect(state.installState).toBe('draft');
    expect(result.frontendEvents).toEqual([{ type: 'plugin-files-replaced', data: { files: state.files, installed: false } }]);
  });

  it('REFUSES to regenerate an existing draft — the bug that made the old chat useless', async () => {
    const state = draft();
    const before = JSON.stringify(state);

    const result = await run('generate_plugin', { description: 'does it need an API key?' }, ctx(state));

    expect(result.success).toBe(false);
    expect(result.error).toContain('edit_plugin_file');
    expect(generatePlugin).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).toBe(before);
  });

  it('replaces a draft only when explicitly told to', async () => {
    generatePlugin.mockResolvedValue({ manifest: { ...MANIFEST, name: 'other' }, toolCode: { 'search.js': '' } });
    const state = draft();
    const result = await run('generate_plugin', { description: 'a different plugin', replace: true }, ctx(state));
    expect(result.success).toBe(true);
    expect(state.name).toBe('other');
  });

  it('rejects a generated entry point that would escape the plugin directory', async () => {
    generatePlugin.mockResolvedValue({ manifest: MANIFEST, toolCode: { '../../evil.js': 'x' } });
    const state = { files: {} };
    const result = await run('generate_plugin', { description: 'x' }, ctx(state));
    expect(result.success).toBe(false);
    expect(state.files).toEqual({});
  });

  it('needs the conversation model rather than guessing one', async () => {
    const result = await run('generate_plugin', { description: 'x' }, { userId: 'u1', pluginState: { files: {} } });
    expect(result.success).toBe(false);
    expect(generatePlugin).not.toHaveBeenCalled();
  });
});

describe('edit_plugin_file', () => {
  it('changes only the matched text and marks an installed plugin as changed', async () => {
    const state = draft({ installState: 'installed' });
    const result = await run(
      'edit_plugin_file',
      { file: 'search.js', edits: [{ search: 'return { success: true };', replace: 'return { success: true, hits: 1 };' }] },
      ctx(state),
    );

    expect(result.success).toBe(true);
    expect(state.files['search.js']).toContain('hits: 1');
    expect(state.installState).toBe('changed');
    expect(result.frontendEvents).toEqual([{ type: 'plugin-file-updated', data: { file: 'search.js', content: state.files['search.js'] } }]);
  });

  it('tolerates whitespace drift in the search string', async () => {
    const state = draft();
    const result = await run(
      'edit_plugin_file',
      { file: 'search.js', edits: [{ search: 'async execute()   {\n return', replace: 'async execute() { console.log(1); return' }] },
      ctx(state),
    );
    expect(result.success).toBe(true);
    expect(state.files['search.js']).toContain('console.log(1)');
  });

  it('a miss changes nothing', async () => {
    const state = draft();
    const before = JSON.stringify(state);
    const result = await run('edit_plugin_file', { file: 'search.js', edits: [{ search: 'not in the file', replace: 'x' }] }, ctx(state));
    expect(result.success).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('an edit that breaks manifest.json is refused whole', async () => {
    const state = draft();
    const before = state.files['manifest.json'];
    const result = await run('edit_plugin_file', { file: 'manifest.json', edits: [{ search: '"version": "1.0.0"', replace: '"version": ' }] }, ctx(state));
    expect(result.success).toBe(false);
    expect(result.error).toContain('not be valid JSON');
    expect(state.files['manifest.json']).toBe(before);
    expect(state.installState).toBe('draft');
  });

  it('writes manifest.json back in the page\'s canonical form, so both sides fingerprint the same text', async () => {
    const state = draft();
    await run('edit_plugin_file', { file: 'manifest.json', edits: [{ search: '"1.0.0"', replace: '"1.1.0"' }] }, ctx(state));
    expect(state.files['manifest.json']).toBe(JSON.stringify({ ...MANIFEST, version: '1.1.0' }, null, 2));
  });
});

describe('file names', () => {
  it('stay inside the plugin', () => {
    for (const ok of ['search.js', 'create-page.js', 'manifest.json', 'agents/helper.json', 'README.md']) expect(isSafePluginFileName(ok), ok).toBe(true);
    for (const bad of ['../x.js', 'a/../../x.js', '/etc/passwd', 'C:\\x.js', 'src/deep/x.js', 'other/x.js', '.env', '', 'a..b.js', null]) {
      expect(isSafePluginFileName(bad), String(bad)).toBe(false);
    }
  });

  it('write_plugin_file refuses an escaping name and writes nothing', async () => {
    const state = draft();
    const result = await run('write_plugin_file', { file: '../evil.js', content: 'x' }, ctx(state));
    expect(result.success).toBe(false);
    expect(Object.keys(state.files)).toEqual(['manifest.json', 'search.js']);
  });

  it('write_plugin_file creates a new tool file', async () => {
    const state = draft();
    const result = await run('write_plugin_file', { file: 'create.js', content: 'export default {}' }, ctx(state));
    expect(result).toMatchObject({ success: true, created: true });
    expect(state.files['create.js']).toBe('export default {}');
  });

  it('manifest.json cannot be deleted', async () => {
    const result = await run('delete_plugin_file', { file: 'manifest.json' }, ctx(draft()));
    expect(result.success).toBe(false);
  });
});

describe('install_plugin', () => {
  it('builds through the authenticated route and reports exactly what was installed', async () => {
    const state = draft();
    routes['POST /plugins/build-generated'] = { status: 200, body: { success: true, installed: true } };

    const result = await run('install_plugin', {}, ctx(state));

    expect(result.success).toBe(true);
    const build = calls.find((c) => c.path === '/plugins/build-generated');
    expect(build.auth).toBe(AUTH);
    expect(build.body.manifest).toEqual(MANIFEST);
    expect(Object.keys(build.body.toolCode)).toEqual(['search.js']); // json files are not code
    expect(state.installState).toBe('installed');
    expect(result.frontendEvents.at(-1)).toEqual({ type: 'plugin-installed', data: { name: 'notion-sync', files: state.files } });
  });

  it('never reinstalls over the same version: bumps it the way the change deserves', async () => {
    const state = draft();
    const withNewTool = { ...MANIFEST, tools: [...MANIFEST.tools, { type: 'notion-create', entryPoint: './search.js' }] };
    state.files['manifest.json'] = JSON.stringify(withNewTool, null, 2);
    routes['GET /plugins/installed/notion-sync/source'] = { status: 200, body: { success: true, files: { 'manifest.json': JSON.stringify(MANIFEST) } } };
    routes['POST /plugins/build-generated'] = { status: 200, body: { success: true, installed: true } };

    const result = await run('install_plugin', {}, ctx(state));

    expect(result.version).toBe('1.1.0'); // a tool was added → minor
    expect(calls.find((c) => c.path === '/plugins/build-generated').body.manifest.version).toBe('1.1.0');
    expect(result.frontendEvents[0]).toEqual({ type: 'plugin-file-updated', data: { file: 'manifest.json', content: state.files['manifest.json'] } });
  });

  it('refuses a manifest pointing at a file the draft does not have, before touching the API', async () => {
    const state = draft();
    delete state.files['search.js'];
    const result = await run('install_plugin', {}, ctx(state));
    expect(result.success).toBe(false);
    expect(result.error).toContain('search.js');
    expect(calls).toEqual([]);
  });

  it('a rejected build is a failure, and the draft stays uninstalled', async () => {
    const state = draft();
    routes['POST /plugins/build-generated'] = { status: 409, body: { success: false, error: 'Another account uses a package with this name.' } };
    const result = await run('install_plugin', {}, ctx(state));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Another account');
    expect(state.installState).toBe('draft');
  });

  it('an unchanged installed plugin is not rebuilt', async () => {
    const result = await run('install_plugin', {}, ctx(draft({ installState: 'installed' })));
    expect(result.success).toBe(true);
    expect(calls).toEqual([]);
  });

  it('needs a user session', async () => {
    const result = await run('install_plugin', {}, ctx(draft()), null);
    expect(result.success).toBe(false);
  });
});

describe('test_plugin_tool', () => {
  it('will not test code that differs from the draft', async () => {
    for (const installState of ['draft', 'changed']) {
      const result = await run('test_plugin_tool', { toolType: 'notion-search', args: {} }, ctx(draft({ installState })));
      expect(result.success).toBe(false);
      expect(result.error).toContain('install_plugin');
    }
    expect(calls).toEqual([]);
  });

  it('runs the installed tool through the agent endpoint; a failing tool is a result, not an error', async () => {
    routes['POST /tools/notion-search/execute'] = { status: 200, body: { success: false, error: '401 unauthorized', details: { error: '401 unauthorized' } } };

    const result = await run('test_plugin_tool', { toolType: 'notion-search', args: { query: 'q3' } }, ctx(draft({ installState: 'installed' })));

    expect(calls[0]).toMatchObject({ method: 'POST', path: '/tools/notion-search/execute', body: { args: { query: 'q3' } }, auth: AUTH });
    expect(result).toMatchObject({ success: true, passed: false, error: '401 unauthorized' });
    const event = result.frontendEvents[0];
    expect(event.type).toBe('plugin-test-result');
    expect(event.data).toMatchObject({ pluginName: 'notion-sync', toolType: 'notion-search', result: { ok: false, args: { query: 'q3' } } });
  });

  it('refuses a tool the plugin does not have', async () => {
    const result = await run('test_plugin_tool', { toolType: 'shell-exec' }, ctx(draft({ installState: 'installed' })));
    expect(result.success).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe('load_plugin', () => {
  it('asks before discarding uninstalled work', async () => {
    const result = await run('load_plugin', { name: 'other' }, ctx(draft({ installState: 'changed' })));
    expect(result.success).toBe(false);
    expect(result.error).toContain('discardDraft');
    expect(calls).toEqual([]);
  });

  it('opens the installed source as the draft', async () => {
    routes['GET /plugins/installed/notion-sync/source'] = {
      status: 200,
      body: { success: true, files: { 'manifest.json': JSON.stringify(MANIFEST), 'search.js': 'x', '../escape.js': 'y' } },
    };
    const state = { files: {} };

    const result = await run('load_plugin', { name: 'notion-sync' }, ctx(state));

    expect(result.success).toBe(true);
    expect(state.files).toEqual({ 'manifest.json': canonicalJson(JSON.stringify(MANIFEST)), 'search.js': 'x' });
    expect(state.installState).toBe('installed');
    expect(result.frontendEvents[0]).toMatchObject({ type: 'plugin-files-replaced', data: { installed: true } });
  });

  it('says plainly when there is no such plugin', async () => {
    const result = await run('load_plugin', { name: 'nope' }, ctx({ files: {} }));
    expect(result).toMatchObject({ success: false, error: 'No installed plugin named "nope".' });
  });
});

describe('shared helpers', () => {
  it('fuzzyFind matches exactly first, then across whitespace drift', () => {
    expect(fuzzyFind('a  b\n c', 'a  b')).toEqual({ start: 0, end: 4 });
    expect(fuzzyFind('a  b\n c', 'b c')).not.toBeNull();
    expect(fuzzyFind('abc', 'xyz')).toBeNull();
    expect(fuzzyFind('abc', '')).toBeNull();
  });

  it('the prompt announces truncation inside the file it cuts', () => {
    const text = formatPluginDraft({ files: { 'manifest.json': '{}', 'big.js': 'x'.repeat(25000) } });
    expect(text.indexOf('manifest.json')).toBeLessThan(text.indexOf('big.js'));
    expect(text).toContain('TRUNCATED: 5000 more characters');
    expect(formatPluginDraft({ files: {} })).toContain('EMPTY');
  });
});
