/**
 * A Tool Forge tool is judged by what it executes, not by its user-chosen name.
 *
 * Its name has no entry in the capability registry (toolCapabilities.js), and an unprofiled tool is
 * refused to every non-owner (memberIsolation fails closed). That refused every custom tool to every
 * teammate, including AI tools that only call a model. What a custom tool runs is fixed by its base
 * (CustomToolExecutor): a model call, or JavaScript/Python through the execute-javascript /
 * execute-python actions, which on a hosted instance run in the kernel tool sandbox. So the gate
 * checks it as exactly that action, with that action's profile.
 *
 * An unknown base keeps the fail-closed path: a name the registry does not know.
 */
const GATE_NAMES = Object.freeze({ AI: 'generate-with-ai-llm', CODE_JS: 'execute-javascript', CODE_PYTHON: 'execute-python' });

export function customToolGateName(base) {
  const key = typeof base === 'string' ? base.toUpperCase() : 'AI';
  return GATE_NAMES[key === '' ? 'AI' : key] || `custom-tool:${String(base)}`;
}
