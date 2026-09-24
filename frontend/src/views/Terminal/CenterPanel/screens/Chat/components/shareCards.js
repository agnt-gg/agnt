// shareCards — which tool calls should end in a one-line "Share this" card.
//
// The moment Annie creates something is the moment it is most worth sharing,
// so a successful create gets the same kind of inline card a Connect request
// does (see connectCards.js). The card opens the one share sheet; the link it
// makes carries the person's invite, so anyone new who joins through it gets a
// free month and the sharer gets credit.
//
// Tolerant by design: tool results are API responses whose exact nesting has
// varied. If an id cannot be found, there is no card. A missing card costs a
// prompt; a card pointing at the wrong item would share the wrong thing.

const CREATES = Object.freeze({
  agnt_workflows: { operation: 'create_workflow', kind: 'workflow', keys: ['workflow', 'workflowId'] },
  agnt_agents: { operation: 'create_agent', kind: 'agent', keys: ['agent', 'agentId'] },
  agnt_tools: { operation: 'create_tool', kind: 'tool', keys: ['tool', 'toolId'] },
});

function parse(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

const idOf = (value) => (typeof value === 'string' && value.trim()) || (Number.isFinite(value) ? String(value) : '');

/** The first plausible { id, name } inside a create response. */
function findCreated(body, keys) {
  const candidates = [body, body?.result, body?.data, body?.result?.data];
  for (const node of candidates) {
    if (!node || typeof node !== 'object') continue;
    for (const key of keys) {
      const nested = node[key];
      if (nested && typeof nested === 'object' && idOf(nested.id)) return { id: idOf(nested.id), name: nested.name || nested.title || '' };
      if (idOf(nested)) return { id: idOf(nested), name: node.name || node.title || '' };
    }
    if (idOf(node.id)) return { id: idOf(node.id), name: node.name || node.title || '' };
  }
  return null;
}

/**
 * The item a tool call created, or null.
 * @param {{ name?: string, args?: object|string, result?: object|string, error?: unknown }} toolCall
 * @returns {{ kind: string, id: string, name: string } | null}
 */
export function shareTarget(toolCall) {
  if (!toolCall || toolCall.error) return null;
  const spec = CREATES[toolCall.name];
  if (!spec) return null;
  const args = parse(toolCall.args);
  if (!args || args.operation !== spec.operation) return null;
  const body = parse(toolCall.result);
  if (!body || body.success === false) return null;
  const created = findCreated(body, spec.keys);
  if (!created) return null;
  const argName = args.agent_data?.name || parse(args.workflow_definition)?.name || parse(args.tool_definition)?.title || parse(args.tool_definition)?.name;
  return { kind: spec.kind, id: created.id, name: created.name || argName || 'This ' + spec.kind };
}
