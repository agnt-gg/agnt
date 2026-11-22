/**
 * The Annie chat beside every AGNT One editor (agents, tools, workflows,
 * skills, widgets), like the Plugin Forge's (requested 2026-10-23).
 *
 * Each kind talks to the backend forge it already has, by the same page-state
 * keys Studio's forge panels send (useToolChatContext, useWorkflowChatContext,
 * ...), so Annie gets that forge's prompt and tools:
 *   tools     -> toolContext / toolState         (Tool Forge prompt)
 *   agents    -> agentContext id 'agent-chat'    (Agent builder; a real id would
 *                + agentState = the agent        make Annie BE that agent)
 *   workflows -> workflowContext / workflowState (Workflow Forge prompt)
 *   widgets   -> widgetContext / widgetState     (Widget Forge prompt)
 *   skills    -> skillContext                    (skill editor block)
 * What is sent is the editor's LIVE values, so Annie sees unsaved edits.
 */

const INTRO = {
  agents: { noun: 'agent', icon: 'fas fa-robot', suggestions: ['Write its instructions', 'Pick the right tools for it', 'Make it more concise'] },
  tools: { noun: 'tool', icon: 'fas fa-tools', suggestions: ['Write the prompt for me', 'Add an input', 'Turn this into JavaScript'] },
  workflows: { noun: 'workflow', icon: 'fas fa-project-diagram', suggestions: ['Add a step that emails me', 'Run it every morning', 'Explain what it does'] },
  skills: { noun: 'skill', icon: 'fas fa-book', suggestions: ['Tighten the instructions', 'Add an example', 'What tools should it allow?'] },
  widgets: { noun: 'widget', icon: 'fas fa-th-large', suggestions: ['Make it match my theme', 'Show live data', 'Add a refresh button'] },
};

/** Fields a chat never needs and that only bloat every turn. */
const HEAVY = new Set(['avatar', 'icon_data', 'screenshot', 'preview_image']);
const lean = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([key, value]) => !HEAVY.has(key) && !(typeof value === 'string' && value.startsWith('data:image'))));

/**
 * @param {'agents'|'tools'|'workflows'|'skills'|'widgets'} kind
 * @param {{ itemId?: string|null, record?: object }} args  record: the item as it would be saved (stored + live edits)
 */
export function forgeChatContext(kind, { itemId = null, record = {} } = {}) {
  const id = itemId ? String(itemId) : null;
  const item = lean({ ...record, ...(id ? { id } : {}) });
  const intro = INTRO[kind] || INTRO.tools;
  const base = {
    // Its own conversation per item (and one for new ones), kept apart from
    // Studio's forge chats and from "chat with this agent".
    channelKey: `one-forge:${kind}:${id || 'new'}`,
    welcome: id
      ? `Hi! I'm Annie. Tell me what to change about this ${intro.noun} and I'll do it.`
      : `Hi! I'm Annie. Describe the ${intro.noun} you want and I'll build it with you.`,
    placeholder: `Describe your ${intro.noun}…`,
    icon: intro.icon,
    suggestions: intro.suggestions.map((text, index) => ({ id: `${kind}-${index}`, text })),
  };
  switch (kind) {
    case 'agents':
      return { ...base, chatType: 'agent', pageContext: { agentId: 'agent-chat' }, pageState: { agentContext: { id: 'agent-chat' }, agentState: item } };
    case 'tools':
      return { ...base, chatType: 'tool', pageContext: { toolId: id || 'default' }, pageState: { toolContext: { id: id || 'new' }, toolState: { id: id || 'new', currentTool: item } } };
    case 'workflows':
      return { ...base, chatType: 'workflow', pageContext: { workflowId: id || 'default' }, pageState: { workflowContext: { id: id || 'new' }, workflowState: { id: id || 'new', name: item.name, nodes: item.nodes || [], edges: item.edges || [] } } };
    case 'widgets':
      return { ...base, chatType: 'widget', pageContext: { widgetId: id || 'widget-forge' }, pageState: { widgetContext: { id: id || 'widget-forge' }, widgetState: item } };
    case 'skills':
      return { ...base, chatType: 'orchestrator', pageContext: {}, pageState: { skillContext: item } };
    default:
      return null;
  }
}

/**
 * The id of an item of this kind that a completed tool call created or saved
 * (so a NEW item's editor can open it), else null.
 */
export function savedItemId(kind, toolCall) {
  if (!toolCall || !/save|create|generate|update|modify/i.test(String(toolCall.name || ''))) return null;
  let result = toolCall.result;
  if (typeof result === 'string') {
    try {
      result = JSON.parse(result);
    } catch {
      return null;
    }
  }
  if (!result || typeof result !== 'object' || result.success === false) return null;
  const singular = { agents: 'agent', tools: 'tool', workflows: 'workflow', skills: 'skill', widgets: 'widget' }[kind];
  if (!singular) return null;
  const nested = result[singular] || result.data?.[singular];
  const id = result[`${singular}Id`] || (nested && typeof nested === 'object' ? nested.id : null);
  return id ? String(id) : null;
}
