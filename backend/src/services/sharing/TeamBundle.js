/**
 * Copy to team / copy to personal: the portable form of agents, workflows,
 * tools and skills.
 *
 * A bundle carries DEFINITIONS, never access. Four rules, all enforced here and
 * re-enforced on the receiving side (sanitize runs again on install, so a
 * hand-built bundle gets exactly the same treatment as one built here):
 *
 *   1. Deny by default. Each kind has an allowlist of fields; anything else
 *      (ownership, usage counters, credit limits, internal ids) is dropped.
 *   2. No secrets. Keys that name a secret are removed at any depth, and string
 *      VALUES that look like a credential are blanked wherever they appear.
 *      A code tool whose code contains one is refused outright: code cannot be
 *      safely edited, and shipping it minus a line would be worse.
 *   3. No local paths. A value that is an absolute path on this machine means
 *      nothing to a teammate and says something about the sender.
 *   4. Credentials travel as SLOTS: "needs GitHub", "uses an OpenAI model". The
 *      receiving space fills a slot with its own connection.
 *
 * Memory, conversations and run history are not a kind here, so they cannot
 * be copied by construction.
 */
import { createHash, randomUUID } from 'node:crypto';

export const KINDS = Object.freeze(['agent', 'workflow', 'tool', 'skill']);
const FIELDS = Object.freeze({
  agent: ['name', 'description', 'icon', 'category', 'systemPrompt', 'provider', 'model', 'toolAccessMode', 'assignedTools', 'assignedWorkflows', 'assignedSkills'],
  workflow: ['name', 'description', 'category', 'nodes', 'edges', 'trigger', 'variables'],
  tool: ['title', 'category', 'type', 'icon', 'description', 'parameters', 'outputs', 'base', 'code', 'config'],
  skill: ['name', 'description', 'instructions', 'category', 'icon', 'license', 'compatibility', 'allowedTools', 'metadata'],
});
const SECRET_KEY = /(password|passwd|secret|token|api[_-]?key|apikey|authorization|credential|private[_-]?key|access[_-]?key|client[_-]?secret|cookie|session)/i;
const SECRET_VALUE = [
  /\bsk-[A-Za-z0-9_-]{16,}/, /\bsk-ant-[A-Za-z0-9_-]{16,}/, /\bgh[pousr]_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bAIza[0-9A-Za-z_-]{30,}/, /\bgsk_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];
const LOCAL_PATH = /^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\|\/(?:Users|home|root|var|tmp|private|mnt)\/)/;
const MAX_DEPTH = 40;
const MAX_ITEMS = 100;
const MAX_BYTES = 2_000_000;

const refuse = (status, message, extra = {}) => { throw Object.assign(new Error(message), { status, ...extra }); };
export const looksSecret = value => typeof value === 'string' && SECRET_VALUE.some(pattern => pattern.test(value));
export const contentHash = definition => createHash('sha256').update(JSON.stringify(definition)).digest('hex');

/** Strip one definition to its allowlist; blank secret keys/values and local paths. Pure. */
export function sanitize(kind, input) {
  if (!KINDS.includes(kind)) refuse(400, 'Unsupported item type');
  const stripped = [];
  const clean = (value, path, depth) => {
    if (depth > MAX_DEPTH) refuse(400, 'Definition is nested too deeply to share safely');
    if (Array.isArray(value)) return value.map((item, index) => clean(item, path + '[' + index + ']', depth + 1));
    if (typeof value === 'string') {
      if (looksSecret(value)) { stripped.push({ path, reason: 'credential' }); return ''; }
      if (LOCAL_PATH.test(value.trim())) { stripped.push({ path, reason: 'local path' }); return ''; }
      return value;
    }
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) { stripped.push({ path: path + '.' + key, reason: 'credential' }); continue; }
      out[key] = clean(child, path + '.' + key, depth + 1);
    }
    return out;
  };
  const definition = {};
  for (const field of FIELDS[kind]) {
    if (input?.[field] === undefined || input[field] === null) continue;
    if (kind === 'tool' && field === 'code') {
      if (typeof input.code !== 'string') continue;
      if (looksSecret(input.code)) refuse(422, 'This tool\'s code contains what looks like a credential. Move it into a connection, then share again.', { code: 'secret_in_code' });
      definition.code = input.code;
      continue;
    }
    definition[field] = clean(input[field], field, 0);
  }
  if (!(definition.name || definition.title)) refuse(400, 'Every shared item needs a name');
  return { definition, stripped };
}

/** What a definition needs from the space it runs in. Values are never included, only which provider. */
export function slotsFor(kind, definition, { nodeProvider = () => null } = {}) {
  const slots = new Map();
  const add = (provider, reason) => { if (typeof provider === 'string' && provider && provider.length < 60) slots.set(provider, slots.get(provider) || reason); };
  if (kind === 'agent') add(definition.provider, 'model');
  if (kind === 'tool') add(definition.config?.provider, 'model');
  if (kind === 'workflow') {
    for (const node of Array.isArray(definition.nodes) ? definition.nodes : []) {
      add(node?.parameters?.provider, 'model');
      add(nodeProvider(node?.type), 'connection');
    }
  }
  return [...slots].map(([provider, reason]) => ({ provider, reason }));
}

/** References one definition makes to other shareable items, as {kind, id}. */
export function referencesOf(kind, definition, { isCustomTool = () => false } = {}) {
  const refs = [];
  if (kind === 'agent') {
    for (const id of definition.assignedTools || []) if (isCustomTool(id)) refs.push({ kind: 'tool', id });
    for (const id of definition.assignedWorkflows || []) refs.push({ kind: 'workflow', id });
    for (const id of definition.assignedSkills || []) refs.push({ kind: 'skill', id });
  }
  if (kind === 'workflow') {
    for (const node of definition.nodes || []) {
      const id = node?.parameters?.toolId || node?.toolId || node?.type;
      if (typeof id === 'string' && isCustomTool(id)) refs.push({ kind: 'tool', id });
    }
  }
  return refs.filter(ref => typeof ref.id === 'string' && ref.id);
}

/**
 * Builds a bundle from the caller's own items plus the dependencies they
 * choose to include. `store` reads ONLY rows owned by `ownerId`; an item that
 * is not theirs is reported as missing, never read.
 */
export async function buildBundle(store, ownerId, requested, { includeDependencies = true, nodeProvider } = {}) {
  if (!Array.isArray(requested) || !requested.length || requested.length > MAX_ITEMS) refuse(400, 'Choose between 1 and ' + MAX_ITEMS + ' items');
  const key = ref => ref.kind + ':' + ref.id;
  const queue = requested.map(ref => ({ kind: ref.kind, id: String(ref.id), dependency: false }));
  const seen = new Set(), items = [], missing = [], dependencies = [];
  const customTools = new Set(await store.customToolIds(ownerId));
  while (queue.length) {
    const ref = queue.shift();
    if (!KINDS.includes(ref.kind)) refuse(400, 'Unsupported item type');
    if (seen.has(key(ref))) continue;
    seen.add(key(ref));
    const row = await store.read(ref.kind, ref.id, ownerId);
    if (!row) { if (!ref.dependency) missing.push(ref); continue; }
    const { definition, stripped } = sanitize(ref.kind, row);
    const refs = referencesOf(ref.kind, definition, { isCustomTool: id => customTools.has(id) });
    items.push({ kind: ref.kind, sourceId: ref.id, dependency: ref.dependency, name: definition.name || definition.title, definition, stripped, slots: slotsFor(ref.kind, definition, { nodeProvider }), hash: contentHash(definition) });
    for (const dependency of refs) {
      if (seen.has(key(dependency))) continue;
      dependencies.push({ ...dependency, requiredBy: key(ref) });
      if (includeDependencies) queue.push({ ...dependency, dependency: true });
    }
    if (items.length > MAX_ITEMS) refuse(413, 'Too many items with their dependencies; share fewer at once');
  }
  if (missing.length) refuse(404, 'Some items were not found in your space', { missing });
  const bundle = { version: 1, items: items.map(({ kind, sourceId, name, definition, hash }) => ({ kind, sourceId, name, definition, hash })) };
  if (JSON.stringify(bundle).length > MAX_BYTES) refuse(413, 'These items are too large to share in one go');
  return {
    bundle,
    preview: {
      items: items.map(({ kind, sourceId, name, dependency, stripped, slots }) => ({ kind, id: sourceId, name, dependency, stripped: stripped.length })),
      dependencies: includeDependencies ? [] : dependencies,
      needs: [...new Map(items.flatMap(item => item.slots).map(slot => [slot.provider, slot])).values()],
      removed: items.reduce((total, item) => total + item.stripped.length, 0),
    },
  };
}

/**
 * Installs a bundle for `ownerId`. Every definition is sanitized again (never
 * trust the sender), ids are freshly minted, and references between items in
 * the bundle are rewritten to the new ids. `replaces` maps "kind:sourceId" to
 * an existing item the owner already has, which is updated in place.
 */
export async function installBundle(store, ownerId, bundle, { replaces = {} } = {}) {
  if (bundle?.version !== 1 || !Array.isArray(bundle.items) || !bundle.items.length || bundle.items.length > MAX_ITEMS) refuse(400, 'Invalid bundle');
  if (JSON.stringify(bundle).length > MAX_BYTES) refuse(413, 'Bundle too large');
  const idMap = new Map();
  const prepared = [];
  for (const item of bundle.items) {
    const { definition } = sanitize(item.kind, item.definition);
    const source = item.kind + ':' + String(item.sourceId);
    let targetId = replaces[source];
    if (targetId && !(await store.read(item.kind, targetId, ownerId))) targetId = null; // not theirs: never overwrite
    targetId = targetId || randomUUID();
    idMap.set(source, targetId);
    prepared.push({ kind: item.kind, source, targetId, definition });
  }
  const remap = (kind, id) => idMap.get(kind + ':' + id) || id;
  const installed = [];
  // Dependencies first, so nothing references an item that does not exist yet.
  const order = { tool: 0, skill: 1, workflow: 2, agent: 3 };
  for (const item of prepared.sort((a, b) => order[a.kind] - order[b.kind])) {
    const definition = { ...item.definition };
    if (item.kind === 'agent') {
      definition.assignedTools = (definition.assignedTools || []).map(id => remap('tool', id));
      definition.assignedWorkflows = (definition.assignedWorkflows || []).map(id => remap('workflow', id));
      definition.assignedSkills = (definition.assignedSkills || []).map(id => remap('skill', id));
    }
    if (item.kind === 'workflow' && Array.isArray(definition.nodes)) {
      definition.nodes = definition.nodes.map(node => {
        if (!node || typeof node !== 'object') return node;
        const next = { ...node };
        if (typeof next.type === 'string' && idMap.has('tool:' + next.type)) next.type = remap('tool', next.type);
        if (typeof next.toolId === 'string') next.toolId = remap('tool', next.toolId);
        if (next.parameters && typeof next.parameters.toolId === 'string') next.parameters = { ...next.parameters, toolId: remap('tool', next.parameters.toolId) };
        return next;
      });
    }
    await store.write(item.kind, item.targetId, definition, ownerId);
    installed.push({ kind: item.kind, source: item.source, id: item.targetId, name: definition.name || definition.title, hash: contentHash(item.definition) });
  }
  return { installed };
}
