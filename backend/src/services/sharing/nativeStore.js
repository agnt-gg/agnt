/**
 * TeamBundle's view of the native tables. Reads are OWNER-CHECKED: a row that
 * is not the caller's is indistinguishable from a missing one. Writes go
 * through the existing models so every schema rule (upserts, provenance
 * columns, ownership triggers) applies exactly as it does for the UI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AgentModel from '../../models/AgentModel.js';
import WorkflowModel from '../../models/WorkflowModel.js';
import CustomToolModel from '../../models/CustomToolModel.js';
import SkillModel from '../../models/SkillModel.js';

const parse = (value, fallback) => { if (value === null || value === undefined || value === '') return fallback; if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return fallback; } };

async function read(kind, id, ownerId) {
  if (kind === 'agent') {
    const row = await AgentModel.findOne(id);
    return row && row.created_by === ownerId ? row : null;
  }
  if (kind === 'workflow') {
    const row = await WorkflowModel.findOne(id);
    if (!row || row.user_id !== ownerId) return null;
    const data = parse(row.workflow_data, {});
    return { ...data, name: data.name || row.name, description: data.description ?? row.description, category: data.category || row.category };
  }
  if (kind === 'tool') {
    const row = await CustomToolModel.findOne(id);
    return row && row.created_by === ownerId ? row : null;
  }
  if (kind === 'skill') {
    const row = await SkillModel.findById(id);
    // Built-in skills ship with every install; there is nothing to copy.
    if (!row || row.user_id !== ownerId || row.is_builtin) return null;
    return { ...row, allowedTools: parse(row.allowed_tools, []), metadata: parse(row.metadata, {}) };
  }
  return null;
}

// A received definition may omit fields the schema requires (NOT NULL). Neutral defaults keep a
// partial bundle installable instead of failing half-way through with a constraint error.
const TOOL_DEFAULTS = { base: 'AI', category: 'custom', type: 'custom', icon: 'fas fa-wrench', description: '', parameters: {}, outputs: {} };

async function write(kind, id, definition, ownerId) {
  if (kind === 'agent') return AgentModel.createOrUpdate(id, { ...definition, status: 'active' }, ownerId);
  if (kind === 'workflow') return WorkflowModel.createOrUpdate(id, JSON.stringify({ ...definition, id }), ownerId, false);
  if (kind === 'tool') return CustomToolModel.createOrUpdate(id, { ...TOOL_DEFAULTS, ...definition, isShareable: false }, ownerId);
  if (kind === 'skill') return SkillModel.createOrUpdate(id, { description: '', ...definition, isBuiltin: 0 }, ownerId);
  throw Object.assign(new Error('Unsupported item type'), { status: 400 });
}

async function customToolIds(ownerId) {
  return (await CustomToolModel.findAllByUserId(ownerId)).map(tool => tool.id);
}

export const nativeStore = Object.freeze({ read, write, customToolIds });

/**
 * Which connection a workflow node type needs, read from the tool library's own
 * schemas (`type` + `authProvider` side by side). Scanned once, lazily.
 */
let providerByType = null;
export function nodeProvider(type) {
  if (typeof type !== 'string' || !type) return null;
  if (!providerByType) {
    providerByType = new Map();
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tools', 'library');
    const walk = dir => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.js')) continue;
        const text = fs.readFileSync(full, 'utf8');
        const nodeType = text.match(/\btype:\s*['"]([\w-]+)['"]/)?.[1];
        const provider = text.match(/\bauthProvider:\s*['"]([\w-]+)['"]/)?.[1];
        if (nodeType && provider) providerByType.set(nodeType, provider);
      }
    };
    walk(root);
  }
  return providerByType.get(type) || null;
}
