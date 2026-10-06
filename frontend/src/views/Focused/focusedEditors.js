/**
 * Focused's item editors — the data half, ported from the AGNT One demo.
 *
 * For each kind: `xValues(raw)` turns a stored record into the fields the
 * editor shows, and `xPayload(fresh, values)` turns the edits back into what
 * the shared store action saves. Payloads are always built on a FRESH full
 * record, so fields this page does not show (routing, credits, skills, the
 * workflow graph's edges and positions…) survive a save untouched.
 *
 * Pure and tested (focusedEditors.spec.js); the components only render these.
 */

import { toKebabCase } from '@/views/_utils/stringFormatting.js';

/**
 * A deep, plain copy of stored data. Records reach here as reactive proxies
 * (from the store, or from the editor's own ref on Discard), which
 * structuredClone refuses with DataCloneError. Workflow graphs and the step
 * library are JSON from the server, so a JSON copy loses nothing.
 */
const plainCopy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// ── Agents ─────────────────────────────────────────────────────────────────

const isActive = (status) => !/^inactive$/i.test(String(status || 'active'));

export function agentValues(agent = {}) {
  return {
    name: agent.name || '',
    description: agent.description || '',
    icon: typeof agent.avatar === 'string' ? agent.avatar : typeof agent.icon === 'string' ? agent.icon : '',
    provider: agent.provider || '',
    model: agent.model || '',
    systemPrompt: agent.systemPrompt || '',
    active: isActive(agent.status),
  };
}

/** The full agent for agents/updateAgent: the stored record with the edits. */
export function agentPayload(agent, values) {
  const upper = /^[A-Z]+$/.test(String(agent.status || 'ACTIVE'));
  const status = values.active ? 'active' : 'inactive';
  return {
    ...agent,
    name: values.name.trim(),
    description: values.description.trim(),
    // agents/updateAgent sends `avatar` as the icon.
    avatar: values.icon || null,
    provider: values.provider,
    model: values.model,
    systemPrompt: values.systemPrompt,
    status: upper ? status.toUpperCase() : status,
  };
}


// ── Workflows ──────────────────────────────────────────────────────────────

/**
 * `nodes` is what the step cards edit (name + settings). Steps added here are
 * kept whole in `added` (the engine needs their type, outputs, position),
 * with the edges that wire them in `newEdges`; `removed` lists stored steps
 * taken out. workflowPayload applies all of it to the FRESH graph on save.
 */
export function workflowValues(raw = {}) {
  return {
    name: raw.name || '',
    description: raw.description || '',
    nodes: (raw.nodes || []).map((n) => ({ id: n.id, text: n.text || '', parameters: plainCopy(n.parameters || {}) })),
    added: [],
    newEdges: [],
    removed: [],
  };
}

const edgeEnds = (e) => [e.start?.id || e.source || e.from, e.end?.id || e.target || e.to];

/**
 * Steps in the order they run: triggers first, then along the edges; any node
 * the walk did not reach (a disconnected step) is appended, so none is lost.
 */
export function workflowStepOrder(raw = {}) {
  const nodes = raw.nodes || [];
  const next = new Map();
  for (const e of raw.edges || []) {
    const [s, t] = edgeEnds(e);
    if (!s || !t) continue;
    if (!next.has(s)) next.set(s, []);
    next.get(s).push(t);
  }
  const order = [];
  const seen = new Set();
  const walk = (id) => {
    if (seen.has(id) || !nodes.some((n) => n.id === id)) return;
    seen.add(id);
    order.push(id);
    for (const t of next.get(id) || []) walk(t);
  };
  const starts = nodes.filter((n) => String(n.category || '') === 'trigger').map((n) => n.id);
  (starts.length ? starts : nodes.slice(0, 1).map((n) => n.id)).forEach(walk);
  nodes.forEach((n) => walk(n.id));
  return order;
}

/**
 * The workflow workflows/updateWorkflow saves: the fresh stored graph with
 * the names, the description, each step's name/settings, and the steps added
 * or removed here. Anything else on the fresh graph (positions, a step added
 * elsewhere meanwhile) is kept; edges are untouched unless steps changed.
 */
export function workflowPayload(fresh, values) {
  const byId = new Map(values.nodes.map((n) => [n.id, n]));
  const edit = (n) => (byId.has(n.id) ? { ...n, text: byId.get(n.id).text, parameters: byId.get(n.id).parameters } : n);
  const removed = new Set(values.removed || []);
  const added = values.added || [];
  const newEdges = values.newEdges || [];
  const stored = fresh.nodes || [];
  const storedIds = new Set(stored.map((n) => n.id));
  const nodes = [...stored.filter((n) => !removed.has(n.id)), ...added.filter((n) => !storedIds.has(n.id))].map(edit);
  let edges = fresh.edges;
  if (removed.size || newEdges.length) {
    const ids = new Set(nodes.map((n) => n.id));
    const live = (e) => edgeEnds(e).every((id) => ids.has(id));
    const storedEdgeIds = new Set((fresh.edges || []).map((e) => e.id).filter(Boolean));
    edges = [...(fresh.edges || []).filter(live), ...newEdges.filter((e) => live(e) && !storedEdgeIds.has(e.id))];
  }
  const workflow = {
    ...fresh,
    name: values.name.trim(),
    description: values.description.trim(),
    nodes,
    edges,
  };
  delete workflow.status;
  delete workflow.created_at;
  delete workflow.updated_at;
  return workflow;
}

export const isRunningStatus = (status) => /^(listening|running|queued|active|executing)$/i.test(String(status || ''));

/** The step library (tools/workflowTools), in the order a picker shows it. */
export const STEP_GROUPS = Object.freeze([
  ['triggers', 'Triggers'],
  ['actions', 'Actions'],
  ['utilities', 'Utilities'],
  ['controls', 'Controls'],
  ['custom', 'My tools'],
  ['widgets', 'Widgets'],
]);
const GROUP_CAP = 40;

/**
 * The step picker's groups: entries matching `query`, each group capped (a
 * search narrows it), with Pro-only steps marked `locked` on a free plan.
 */
export function stepLibraryGroups(library, query = '', { isPro = true } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const hit = (e) => !q || [e.title, e.description, e.type].some((s) => String(s || '').toLowerCase().includes(q));
  return STEP_GROUPS.map(([id, label]) => {
    const all = (library?.[id] || []).filter((e) => e && e.type && hit(e));
    return { id, label, more: Math.max(0, all.length - GROUP_CAP), items: all.slice(0, GROUP_CAP).map((e) => ({ entry: e, locked: !!e.requiresPro && !isPro })) };
  }).filter((g) => g.items.length);
}

/**
 * A step for the engine, built from a step-library entry exactly as Workflow
 * Forge builds one (WorkflowDesigner#createNode): library defaults become
 * values, a select keeps its choices beside it as `<key>_options`, and a
 * custom tool keeps its parameter objects.
 */
export function workflowNodeFromTool(libraryEntry, { id, x = 0, y = 0, timeZone = 'UTC' }) {
  // A copy, so the saved node never shares objects with the store's library.
  const entry = plainCopy(libraryEntry);
  const custom = entry.category === 'custom';
  const parameters = {};
  for (const [key, def] of Object.entries(entry.parameters || {})) {
    if (custom) {
      parameters[key] = def;
    } else if (def && typeof def === 'object' && Object.prototype.hasOwnProperty.call(def, 'type')) {
      parameters[key] = def.default ?? '';
      if (def.defaultFrom === 'browserTimeZone' && !parameters[key]) parameters[key] = timeZone;
      if (def.inputType === 'select') parameters[`${key}_options`] = def.options;
    } else {
      parameters[key] = def;
    }
  }
  return {
    id,
    text: entry.title || humanKey(entry.type),
    x,
    y,
    isEditing: false,
    type: entry.type,
    icon: entry.icon,
    category: entry.category,
    isSelected: false,
    parameters,
    description: entry.description,
    error: null,
    outputs: custom ? { generatedText: { type: 'string' }, tokenCount: { type: 'number' }, error: { type: 'string' } } : entry.outputs,
  };
}

/** An edge as Workflow Forge draws one (WorkflowDesigner#createEdge). */
export function workflowEdge(id, fromId, toId) {
  return { id, start: { id: fromId, type: 'output' }, end: { id: toId, type: 'input' }, startX: 0, startY: 0, endX: 0, endY: 0, isActive: false };
}

/**
 * Adds a library entry as a step, wired in: a trigger goes first (into the
 * first step that is not a trigger), anything else runs after the last step.
 * Placed below the graph so the full editor shows it in a sensible spot.
 * Mutates `values`; `fresh` is the graph the editor opened (for positions).
 */
export function addWorkflowStep(values, fresh, entry, { nodeId, edgeId, timeZone }) {
  const graph = workflowPayload(fresh, values);
  const order = workflowStepOrder(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const last = byId.get(order[order.length - 1]);
  const bottom = graph.nodes.reduce((y, n) => Math.max(y, Number(n.y) || 0), 0);
  const node = workflowNodeFromTool(entry, { id: nodeId, x: Number(last?.x) || 100, y: graph.nodes.length ? bottom + 140 : 100, timeZone });
  values.added.push(node);
  values.nodes.push({ id: node.id, text: node.text, parameters: plainCopy(node.parameters) });
  if (entry.category === 'trigger') {
    const first = order.find((id) => byId.get(id)?.category !== 'trigger');
    if (first) values.newEdges.push(workflowEdge(edgeId, node.id, first));
  } else if (last) {
    values.newEdges.push(workflowEdge(edgeId, last.id, node.id));
  }
  return node;
}

/**
 * Removes a step. A step in the middle of a chain (one way in, one way out)
 * is bridged, so removing it does not cut the workflow in two.
 */
export function removeWorkflowStep(values, fresh, id, { edgeId }) {
  const graph = workflowPayload(fresh, values);
  const into = (graph.edges || []).filter((e) => edgeEnds(e)[1] === id);
  const out = (graph.edges || []).filter((e) => edgeEnds(e)[0] === id);
  if (values.added.some((n) => n.id === id)) values.added = values.added.filter((n) => n.id !== id);
  else values.removed.push(id);
  values.nodes = values.nodes.filter((n) => n.id !== id);
  values.newEdges = values.newEdges.filter((e) => !edgeEnds(e).includes(id));
  if (into.length === 1 && out.length === 1) values.newEdges.push(workflowEdge(edgeId, edgeEnds(into[0])[0], edgeEnds(out[0])[1]));
}

/** A step's settings to show: a select's `<key>_options` list is not one. */
export const visibleStepParams = (parameters = {}) => Object.keys(parameters).filter((k) => !(k.endsWith('_options') && k.slice(0, -8) in parameters));

// ── Tools ──────────────────────────────────────────────────────────────────

export const TOOL_META_KEYS = new Set(['instructions', 'provider', 'model']);
export const INPUT_TYPES = Object.freeze([
  ['text', 'Text'],
  ['textarea', 'Long text'],
  ['number', 'Number'],
  ['checkbox', 'Yes / no'],
  ['select', 'Choice'],
]);

export function toolParams(p) {
  if (!p) return {};
  if (typeof p === 'string') {
    try {
      return JSON.parse(p) || {};
    } catch {
      return {};
    }
  }
  return typeof p === 'object' && !Array.isArray(p) ? p : {};
}

export function codeLabel(raw = {}) {
  const b = String(raw.base || raw.language || '').toUpperCase();
  if (b.includes('PYTHON')) return 'Python';
  if (b.includes('JS') || b.includes('JAVASCRIPT')) return 'JavaScript';
  return raw.base || 'Code';
}

/**
 * The three kinds of custom tool, as Tool Forge and CustomToolExecutor name
 * them: a prompt template the AI fills in, or code that runs.
 */
export const TOOL_TYPES = Object.freeze([
  { value: 'AI', label: 'Prompt', icon: 'fas fa-magic', hint: 'A prompt template the AI fills in with the inputs.' },
  { value: 'CODE_JS', label: 'JavaScript', icon: 'fab fa-js', hint: 'JavaScript that runs with the inputs in `params`.' },
  { value: 'CODE_PYTHON', label: 'Python', icon: 'fab fa-python', hint: 'Python that runs with the inputs in `params`.' },
]);

/**
 * A stored `base` as one of TOOL_TYPES. Missing is AI (the executor's
 * default); the older 'JS' / 'PYTHON' spellings read as their code type, so
 * the next save writes the name the executor runs.
 */
export function toolBase(raw = {}) {
  const b = String(raw.base || 'AI').toUpperCase();
  if (b === 'AI') return 'AI';
  if (b.includes('PY')) return 'CODE_PYTHON';
  if (b.includes('JS') || b.includes('JAVASCRIPT')) return 'CODE_JS';
  return raw.base;
}

export const isPromptTool = (values) => values.base === 'AI';

export function toolValues(raw = {}) {
  const params = toolParams(raw.parameters);
  const inputs = Object.entries(params)
    .filter(([key]) => !TOOL_META_KEYS.has(key))
    .map(([key, f]) => ({
      key,
      originalKey: key,
      label: (f && f.label) || key,
      type: (f && f.type) || 'text',
      required: !!(f && f.required),
      ...(f && f.value !== undefined ? { value: f.value } : {}),
    }));
  return {
    name: raw.title || '',
    description: raw.description || '',
    category: raw.category || 'custom',
    code: raw.code || '',
    base: toolBase(raw),
    instructions: String(params.instructions || ''),
    provider: params.provider || '',
    model: params.model || '',
    inputs,
  };
}

/** Throws a plain-language error the save bar shows; null when valid. */
export function validateToolInputs(inputs) {
  const keys = inputs.map((i) => String(i.key || '').trim());
  if (keys.some((k) => !k)) throw new Error('Every input needs a name.');
  if (new Set(keys).size !== keys.length) throw new Error('Two inputs have the same name.');
  if (keys.some((k) => TOOL_META_KEYS.has(k))) throw new Error('“instructions”, “provider” and “model” can’t be used as input names.');
  return null;
}

/** Input names cannot hold braces or spaces (they are {{placeholders}}). */
export const cleanInputKey = (s) => String(s || '').replace(/[{}\s]/g, '');

/** Renaming an input renames it in an AI tool's prompt too. */
export function renameInPrompt(prompt, from, to) {
  if (!from || !to || from === to) return prompt;
  return String(prompt || '').split(`{{${from}}}`).join(`{{${to}}}`);
}

/** Tool Forge's outputs for a tool that has none of its own. */
const defaultToolOutputs = (prompt) => ({
  success: { type: 'boolean', description: 'Indicates whether the operation was successful' },
  result: { type: 'any', description: prompt ? 'The text generated by the LLM' : 'The result from code execution' },
  error: { type: 'string', description: 'Error message if the operation failed' },
});

/** The tool tools/saveCustomTool upserts: the fresh record with the edits. */
export function toolPayload(fresh, values) {
  validateToolInputs(values.inputs);
  const prompt = isPromptTool(values);
  const title = values.name.trim();
  const base = toolParams(fresh.parameters);
  const parameters = {};
  for (const i of values.inputs) {
    const key = i.key.trim();
    const old = base[i.originalKey || i.key] || {};
    parameters[key] = {
      ...old,
      type: i.type,
      label: String(i.label || '').trim() || key,
      required: !!i.required,
      ...(i.value !== undefined ? { value: i.value } : {}),
    };
  }
  if (prompt) Object.assign(parameters, { instructions: values.instructions, provider: values.provider, model: values.model });
  return {
    ...fresh,
    base: values.base,
    title,
    description: values.description.trim(),
    category: values.category.trim() || 'custom',
    // A prompt tool that carries code is run AS code (CustomToolExecutor),
    // so a tool switched to Prompt drops its code. One that was always a
    // prompt tool keeps whatever it stored.
    code: prompt ? (toolBase(fresh) === 'AI' ? fresh.code : null) : values.code,
    // Workflows find a custom tool by `type`; Tool Forge derives it from the
    // title. A tool made here had none, so it never appeared as a step.
    type: fresh.type || toKebabCase(title) || 'custom-tool',
    icon: fresh.icon || 'custom',
    outputs: fresh.outputs || defaultToolOutputs(prompt),
    parameters,
    isShareable: fresh.isShareable ?? !!fresh.is_shareable,
  };
}

// ── Skills ─────────────────────────────────────────────────────────────────

/** Skills found on disk (fs-…) or shipped with AGNT are read, not changed. */
export const isReadOnlySkill = (skill = {}) => String(skill.id || '').startsWith('fs-') || !!skill.is_builtin;

export function skillValues(raw = {}) {
  return {
    name: raw.name || '',
    description: raw.description || '',
    instructions: raw.instructions || '',
    category: raw.category || 'general',
  };
}

export function skillPayload(values) {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    instructions: values.instructions,
    category: values.category.trim() || 'general',
  };
}

// ── Widgets ────────────────────────────────────────────────────────────────

export function widgetValues(raw = {}) {
  return { name: raw.name || '', description: raw.description || '', source_code: raw.source_code || '' };
}

/** Only what changed (widgetDefinitions/updateDefinition patches). */
export function widgetUpdates(base, values) {
  const updates = {};
  for (const k of ['name', 'description', 'source_code']) {
    if (values[k] !== base[k]) updates[k] = k === 'source_code' ? values[k] : String(values[k]).trim();
  }
  return updates;
}

// ── New items ─────────────────────────────────────────────────────────────

/**
 * The stored record a new item starts from, so the same xValues/xPayload
 * pair edits it and the create action saves it. A new tool starts as a
 * prompt (AI) tool; the editor's Type switch makes it JavaScript or Python.
 */
export function blankRecord(kind) {
  if (kind === 'workflows') return { name: '', description: '', nodes: [], edges: [] };
  if (kind === 'tools') return { title: '', description: '', category: 'custom', base: 'AI', code: '', parameters: { instructions: '', provider: '', model: '' }, isShareable: false };
  if (kind === 'widgets') return { name: '', description: '', widget_type: 'html', source_code: '' };
  return { name: '', description: '', instructions: '', category: 'general' };
}

// ── Workflow step settings ─────────────────────────────────────────────────

/** "maxRetries" / "max_retries" → "Max retries". */
export function humanKey(key) {
  const s = String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

/** Which control a setting gets, from its current value. */
export function paramKind(value) {
  if (typeof value === 'boolean') return 'switch';
  if (typeof value === 'number') return 'number';
  if (value !== null && typeof value === 'object') return 'json';
  const s = value == null ? '' : String(value);
  return s.length > 60 || s.includes('\n') ? 'textarea' : 'text';
}

/** Time since a timestamp, in the demo's short words. */
export function ago(at, now = Date.now()) {
  const t = at instanceof Date ? at.getTime() : new Date(at || 0).getTime();
  if (!Number.isFinite(t) || t <= 0) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
