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

export function workflowValues(raw = {}) {
  return {
    name: raw.name || '',
    description: raw.description || '',
    nodes: (raw.nodes || []).map((n) => ({ id: n.id, text: n.text || '', parameters: structuredClone(n.parameters || {}) })),
  };
}

/**
 * Steps in the order they run: triggers first, then along the edges; any node
 * the walk did not reach (a disconnected step) is appended, so none is lost.
 */
export function workflowStepOrder(raw = {}) {
  const nodes = raw.nodes || [];
  const next = new Map();
  for (const e of raw.edges || []) {
    const s = e.start?.id || e.source || e.from;
    const t = e.end?.id || e.target || e.to;
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
 * only names, the description and each step's name/settings changed.
 */
export function workflowPayload(fresh, values) {
  const byId = new Map(values.nodes.map((n) => [n.id, n]));
  const workflow = {
    ...fresh,
    name: values.name.trim(),
    description: values.description.trim(),
    nodes: (fresh.nodes || []).map((n) => (byId.has(n.id) ? { ...n, text: byId.get(n.id).text, parameters: byId.get(n.id).parameters } : n)),
  };
  delete workflow.status;
  delete workflow.created_at;
  delete workflow.updated_at;
  return workflow;
}

export const isRunningStatus = (status) => /^(listening|running|queued|active|executing)$/i.test(String(status || ''));

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
    isAI: String(raw.base || '').toUpperCase() === 'AI',
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

/** The tool tools/saveCustomTool upserts: the fresh record with the edits. */
export function toolPayload(fresh, values) {
  validateToolInputs(values.inputs);
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
  if (values.isAI) Object.assign(parameters, { instructions: values.instructions, provider: values.provider, model: values.model });
  return {
    ...fresh,
    title: values.name.trim(),
    description: values.description.trim(),
    category: values.category.trim() || 'custom',
    code: values.isAI ? fresh.code : values.code,
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
 * pair edits it and the create action saves it. A new tool is a prompt (AI)
 * tool: the no-code kind this editor can complete on its own.
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
