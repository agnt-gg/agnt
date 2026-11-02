import { it, expect, vi, afterEach } from 'vitest';
import { normalizeToolBase, customToolGateName } from './customToolCapabilities.js';

// bravo retest #2: a tool saved with base "JavaScript" ran from chat but /tools/:name/execute refused it as
// "custom-tool: JavaScript has no declared capabilities". The gate and the runner now share one map.
it.each([
  ['JavaScript', null, 'CODE_JS'], ['javascript', null, 'CODE_JS'], ['js', null, 'CODE_JS'], ['CODE_JS', null, 'CODE_JS'],
  ['Python', null, 'CODE_PYTHON'], ['CODE_PYTHON', null, 'CODE_PYTHON'], ['AI', null, 'AI'], [undefined, null, 'AI'],
  ['Something', 'return 1', 'CODE_JS'], ['Something', null, 'AI'],
])('base %s (code: %s) runs as %s, and the gate judges the same action', (base, code, expected) => {
  expect(normalizeToolBase(base, code)).toBe(expected);
  expect(customToolGateName(base, code)).toBe({ AI: 'generate-with-ai-llm', CODE_JS: 'execute-javascript', CODE_PYTHON: 'execute-python' }[expected]);
});

const hosted = vi.hoisted(() => ({ value: true }));
vi.mock('./toolRunAuthority.js', async (importOriginal) => ({ ...(await importOriginal()), hostedToolBoundaryRequired: () => hosted.value }));
afterEach(() => vi.unstubAllEnvs());

it('a teammate passes the gate for a "JavaScript" custom tool on a hosted instance', async () => {
  vi.stubEnv('AGNT_TENANT_SLUG', 'bravo'); vi.stubEnv('AGNT_TENANT_OWNER', 'owner-1'); vi.stubEnv('AGNT_TENANT_MEMBERS', 'owner-1,member-2');
  const { memberRefusal } = await import('./memberIsolation.js');
  expect(memberRefusal(customToolGateName('JavaScript', 'return 1'), {}, 'member-2')).toBeNull();
});
