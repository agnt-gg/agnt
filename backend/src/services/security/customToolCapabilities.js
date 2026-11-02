/**
 * A Tool Forge tool is judged by what it executes, not by its user-chosen name.
 *
 * Its name has no entry in the capability registry (toolCapabilities.js), and an unprofiled tool is
 * refused to every non-owner (memberIsolation fails closed). What a custom tool runs is fixed by its base:
 * a model call, or JavaScript/Python through the execute-javascript / execute-python actions, which on a
 * hosted instance run in the kernel tool sandbox. So the gate checks it as exactly that action.
 *
 * ONE MAP FOR EVERYONE. Tool Forge stores 'CODE_JS' | 'CODE_PYTHON' | 'AI'; the orchestrator's save path
 * stores friendly labels ('JavaScript', 'Python'). The runner understood both, the gate only the first, so
 * a 'JavaScript' tool ran from chat and was refused over /tools/:name/execute as "custom-tool: JavaScript
 * has no declared capabilities" (bravo retest, Nov 2026). The gate, the runner, workflow nodes and the
 * executor all resolve the base here, so they cannot disagree again.
 */
const BASES = Object.freeze({ javascript: 'CODE_JS', js: 'CODE_JS', code_js: 'CODE_JS', node: 'CODE_JS', python: 'CODE_PYTHON', py: 'CODE_PYTHON', code_python: 'CODE_PYTHON', ai: 'AI', llm: 'AI' });
const GATE_NAMES = Object.freeze({ AI: 'generate-with-ai-llm', CODE_JS: 'execute-javascript', CODE_PYTHON: 'execute-python' });

/** The executor base for a stored base label. Unknown: code means JavaScript, no code means a model call. */
export function normalizeToolBase(base, code = null) {
  const known = BASES[String(base ?? '').trim().toLowerCase()];
  if (known) return known;
  return code ? 'CODE_JS' : 'AI';
}

export function customToolGateName(base, code = null) {
  return GATE_NAMES[normalizeToolBase(base, code)];
}
