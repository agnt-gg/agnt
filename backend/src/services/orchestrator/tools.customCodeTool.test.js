import { it, expect, vi, afterEach } from 'vitest';

// bravo, Nov 2026: execute_custom_agnt_tool refused every CODE tool ("Missing 'parameters.instructions'"),
// because it only knew AI prompt tools. A code tool now runs through the one Tool Forge executor.
// tools.js fetches the definition with node-fetch from the local API: mocked, so no real server is called.
const state = vi.hoisted(() => ({ ran: [], fetched: [] }));
vi.mock('node-fetch', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    default: async (url) => {
      state.fetched.push(String(url));
      return { ok: true, status: 200, json: async () => ({ id: 't1', base: 'CODE_JS', code: 'return 1', parameters: {} }), text: async () => '' };
    },
  };
});
vi.mock('./customToolRunner.js', async (importOriginal) => ({
  ...(await importOriginal()),
  runCustomTool: async (tool, args, userId) => { state.ran.push({ base: tool.base, args, userId }); return { success: true, result: { doubled: Number(args.n) * 2 } }; },
}));
const { executeTool } = await import('./tools.js');
afterEach(() => { state.ran.length = 0; state.fetched.length = 0; });

it('runs a code tool through the Tool Forge executor and returns its result', async () => {
  const out = JSON.parse(await executeTool('execute_custom_agnt_tool', { tool_id: 't1', input_parameters: { n: 21 } }, 'Bearer x', { userId: 'u1' }));
  expect(state.fetched.some((url) => url.endsWith('/api/custom-tools/t1'))).toBe(true);
  expect(out).toMatchObject({ success: true, tool_id: 't1', result: { success: true, result: { doubled: 42 } } });
  expect(state.ran).toEqual([{ base: 'CODE_JS', args: { n: 21 }, userId: 'u1' }]);
});
