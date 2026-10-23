/**
 * Annie's drafts, applied to an AGNT One editor's fields.
 *
 * The forges' generate tools do not save: they send the draft to the page
 * (reported 2026-10-23: "the chats are not generating and filling the
 * fields"). Studio's editors apply these; the AGNT One editors only reloaded
 * after a save, so a draft went nowhere. The events, per forge:
 *   tools     tool-field-updated {field, value} (title, description, toolType,
 *             code, instructions), tool-custom-field-added/-removed,
 *             tool-fields-cleared                  (toolForgeTools.js)
 *   widgets   widget-field-updated {field, value}, widget-fields-cleared
 *                                                  (widgetTools.js)
 *   workflows workflow-updated {id, nodes, edges, name} (realtime broadcast
 *             of update_workflow, re-dispatched on window)
 *   agents    agent-updated {updatedAgent}       (agentTools.js)
 * A draft lands as unsaved edits: the save bar appears and Save keeps it.
 */
import { workflowValues } from './focusedEditors.js';

const TOOL_BASE = { AI: 'AI', CODE_JS: 'CODE_JS', CODE_PYTHON: 'CODE_PYTHON' };
const TOOL_FIELD = { title: 'name', description: 'description', code: 'code', instructions: 'instructions' };

/** A tool or widget event -> the editor's new values, or null when it is not for this editor. */
export function applyFieldDraft(kind, values, eventType, data = {}) {
  if (kind === 'tools') {
    if (eventType === 'tool-fields-cleared') return { ...values, name: '', instructions: '', inputs: [] };
    if (eventType === 'tool-field-updated') {
      if (data.field === 'toolType') return TOOL_BASE[data.value] ? { ...values, base: data.value } : null;
      const key = TOOL_FIELD[data.field];
      return key && data.value !== undefined ? { ...values, [key]: String(data.value ?? '') } : null;
    }
    if (eventType === 'tool-custom-field-added' && data.fieldName) {
      const input = { key: String(data.fieldName), originalKey: '', label: data.label || data.fieldName, type: data.fieldType || 'text', required: false, ...(data.value ? { value: data.value } : {}) };
      const rest = (values.inputs || []).filter((i) => i.key !== input.key);
      const existing = (values.inputs || []).find((i) => i.key === input.key);
      return { ...values, inputs: [...rest, existing ? { ...existing, ...input, originalKey: existing.originalKey } : input] };
    }
    if (eventType === 'tool-custom-field-removed' && data.fieldName) {
      return { ...values, inputs: (values.inputs || []).filter((i) => i.key !== data.fieldName) };
    }
    return null;
  }
  if (kind === 'widgets') {
    if (eventType === 'widget-fields-cleared') return { ...values, name: '', description: '', source_code: '' };
    if (eventType === 'widget-field-updated' && ['name', 'description', 'source_code'].includes(data.field) && data.value !== undefined) {
      return { ...values, [data.field]: String(data.value ?? '') };
    }
    return null;
  }
  return null;
}

/**
 * A whole workflow graph from Annie, as edits on the STORED graph that the
 * editor's save keeps (workflowPayload): steps added and removed, every
 * step's name and settings, and the draft's wiring.
 */
export function workflowDraftValues(stored = {}, draft = {}, current = {}) {
  const nodes = Array.isArray(draft.nodes) ? draft.nodes : [];
  const storedIds = new Set((stored.nodes || []).map((n) => n.id));
  const draftIds = new Set(nodes.map((n) => n.id));
  return {
    ...workflowValues({ ...draft, nodes }),
    name: draft.name || current.name || '',
    description: draft.description ?? current.description ?? '',
    added: nodes.filter((n) => !storedIds.has(n.id)),
    removed: [...storedIds].filter((id) => !draftIds.has(id)),
    newEdges: [],
    edges: Array.isArray(draft.edges) ? draft.edges : [],
  };
}

/** Is this workflow broadcast about the workflow this editor has open? */
export function isDraftForWorkflow(draft, itemId) {
  const id = draft?.id ? String(draft.id) : '';
  return itemId ? id === String(itemId) : !id || id === 'default' || id === 'new';
}

/** An agent from Annie -> the agent editor's fields (she says instructions, the editor says systemPrompt). */
export function agentDraftValues(agent = {}, current = {}) {
  const pick = (value, fallback) => (typeof value === 'string' && value.trim() ? value : fallback);
  return {
    ...current,
    name: pick(agent.name, current.name),
    description: pick(agent.description, current.description),
    systemPrompt: pick(agent.instructions, pick(agent.systemPrompt, current.systemPrompt)),
    provider: pick(agent.provider, current.provider),
    model: pick(agent.model, current.model),
  };
}

/** The tools Annie gave an agent, when she gave any. */
export function agentDraftTools(agent = {}) {
  const list = Array.isArray(agent.assignedTools) && agent.assignedTools.length ? agent.assignedTools : Array.isArray(agent.tools) ? agent.tools : [];
  const names = list.map((t) => (typeof t === 'string' ? t : t?.name || t?.id)).filter(Boolean);
  return names.length ? names : null;
}
