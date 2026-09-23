/**
 * TeamBundle's view of the native tables. Reads are OWNER-CHECKED: a row that
 * is not the caller's is indistinguishable from a missing one. Writes go
 * through the existing models so every schema rule (upserts, provenance
 * columns, ownership triggers) applies exactly as it does for the UI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import db from '../../models/database/index.js';
import AgentModel from '../../models/AgentModel.js';
import WorkflowModel from '../../models/WorkflowModel.js';
import CustomToolModel from '../../models/CustomToolModel.js';
import SkillModel from '../../models/SkillModel.js';
import { notifyWidgetChanged } from '../../utils/widgetChangeNotifier.js';

const parse = (value, fallback) => { if (value === null || value === undefined || value === '') return fallback; if (typeof value !== 'string') return value; try { return JSON.parse(value); } catch { return fallback; } };
const get = (sql, args) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => (error ? reject(error) : resolve(row || null))));
const all = (sql, args) => new Promise((resolve, reject) => db.all(sql, args, (error, rows) => (error ? reject(error) : resolve(rows || []))));
const run = (sql, args) => new Promise((resolve, reject) => db.run(sql, args, function done(error) { return error ? reject(error) : resolve(this.changes); }));
const refuse = (status, message) => { throw Object.assign(new Error(message), { status }); };
/** Workspaces share widget_layouts with custom pages; this prefix is what makes a row a workspace (WorkspaceService). */
const workspaceRoute = id => 'workspace:' + id;

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
  if (kind === 'widget') {
    const row = await get('SELECT * FROM widget_definitions WHERE id=?', [id]);
    if (!row || row.user_id !== ownerId) return null;
    return { ...row, config: parse(row.config, {}), data_bindings: parse(row.data_bindings, []), default_size: parse(row.default_size, null), min_size: parse(row.min_size, null), useThemeStyles: row.use_theme_styles !== 0 };
  }
  if (kind === 'goal') {
    const row = await get('SELECT * FROM goals WHERE id=? AND deleted_at IS NULL', [id]);
    if (!row || row.user_id !== ownerId) return null;
    const tasks = await all('SELECT * FROM tasks WHERE goal_id=? ORDER BY order_index, created_at', [id]);
    return {
      title: row.title, description: row.description, priority: row.priority, successCriteria: parse(row.success_criteria, {}),
      tasks: tasks.map(task => ({ key: task.id, parentKey: task.parent_task_id, title: task.title, description: task.description, requiredTools: parse(task.required_tools, []), dependencies: parse(task.dependencies, []), orderIndex: task.order_index, agentId: task.agent_id, workflowId: task.workflow_id })),
    };
  }
  if (kind === 'workspace') {
    const row = await get('SELECT * FROM widget_layouts WHERE user_id=? AND route=?', [ownerId, workspaceRoute(id)]);
    if (!row) return null;
    return { name: row.page_name, widgets: parse(row.layout_data, {}).widgets || [] };
  }
  return null;
}

const json = value => JSON.stringify(value ?? null);

async function writeWidget(id, definition, ownerId) {
  const existing = await get('SELECT user_id FROM widget_definitions WHERE id=?', [id]);
  if (existing && existing.user_id !== ownerId) refuse(409, 'That widget id is already in use');
  const values = [definition.name, definition.description || '', definition.icon || 'fas fa-puzzle-piece', definition.category || 'custom', definition.widget_type || 'html', definition.source_code || '', json(definition.config || {}), json(definition.data_bindings || []), json(definition.default_size || { cols: 4, rows: 3 }), json(definition.min_size || { cols: 2, rows: 2 })];
  if (existing) await run('UPDATE widget_definitions SET name=?,description=?,icon=?,category=?,widget_type=?,source_code=?,config=?,data_bindings=?,default_size=?,min_size=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?', [...values, id, ownerId]);
  else await run('INSERT INTO widget_definitions (name,description,icon,category,widget_type,source_code,config,data_bindings,default_size,min_size,id,user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [...values, id, ownerId]);
  // Older databases lack the column; the widget still installs with the default.
  if (definition.useThemeStyles !== undefined) await run('UPDATE widget_definitions SET use_theme_styles=? WHERE id=?', [definition.useThemeStyles ? 1 : 0, id]).catch(() => {});
  notifyWidgetChanged({ widgetId: id, userId: ownerId, action: existing ? 'updated' : 'created', source: 'share' });
}

/** Always a NEW goal (kinds.js: goals are not replaceable). Tasks get fresh ids; links to items this owner does not have are dropped. */
async function writeGoal(id, definition, ownerId) {
  if (await get('SELECT id FROM goals WHERE id=?', [id])) refuse(409, 'That goal already exists');
  const now = new Date().toISOString();
  const owns = async (table, column, rowId) => (rowId ? Boolean(await get(`SELECT id FROM ${table} WHERE id=? AND ${column}=?`, [rowId, ownerId])) : false);
  // Every task gets a key first: a hand-built bundle may omit them, and a task id must never be null.
  const tasks = (Array.isArray(definition.tasks) ? definition.tasks : []).map((task, index) => ({ ...task, key: String(task.key ?? 'task-' + index) }));
  const taskIds = new Map(tasks.map(task => [task.key, randomUUID()]));
  const idOf = key => (key === null || key === undefined ? null : taskIds.get(String(key)) || null);
  // Parents before children: parent_task_id is a foreign key.
  const depth = task => { let level = 0, cursor = task; const seen = new Set(); while (cursor?.parentKey != null && !seen.has(cursor.parentKey) && level < 50) { seen.add(cursor.parentKey); cursor = tasks.find(t => String(t.key) === String(cursor.parentKey)); level++; } return level; };
  await run('INSERT INTO goals (id,user_id,title,description,priority,success_criteria,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [id, ownerId, definition.title || definition.name, definition.description || '', definition.priority || 'medium', json(definition.successCriteria || {}), 'planning', now, now]);
  for (const task of [...tasks].sort((a, b) => depth(a) - depth(b))) {
    const agentId = (await owns('agents', 'created_by', task.agentId)) ? task.agentId : null;
    const workflowId = (await owns('workflows', 'user_id', task.workflowId)) ? task.workflowId : null;
    const dependencies = (Array.isArray(task.dependencies) ? task.dependencies : []).map(idOf).filter(Boolean);
    await run('INSERT INTO tasks (id,goal_id,parent_task_id,title,description,required_tools,dependencies,order_index,agent_id,workflow_id,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [idOf(task.key), id, idOf(task.parentKey), task.title || 'Task', task.description || '', json(Array.isArray(task.requiredTools) ? task.requiredTools : []), json(dependencies), Number.isFinite(task.orderIndex) ? task.orderIndex : 0, agentId, workflowId, agentId ? 'assigned' : 'pending', now]);
  }
}

/** The layout_data shape WorkspaceService reads. Conversations never travel: the copy starts with fresh chats. */
async function writeWorkspace(id, definition, ownerId) {
  const layout = json({ widgets: definition.widgets || [], ai: null, channelConversations: {}, updatedAt: Date.now() });
  const existing = await get('SELECT id FROM widget_layouts WHERE user_id=? AND route=?', [ownerId, workspaceRoute(id)]);
  if (existing) return run('UPDATE widget_layouts SET page_name=?,layout_data=?,updated_at=CURRENT_TIMESTAMP WHERE id=?', [definition.name, layout, existing.id]);
  const order = await get("SELECT COALESCE(MAX(page_order),0)+1 AS next FROM widget_layouts WHERE user_id=? AND route LIKE 'workspace:%'", [ownerId]);
  return run('INSERT INTO widget_layouts (id,user_id,page_id,page_name,page_icon,page_order,route,layout_data) VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), ownerId, id, definition.name, 'fas fa-th', order?.next || 1, workspaceRoute(id), layout]);
}

// A received definition may omit fields the schema requires (NOT NULL). Neutral defaults keep a
// partial bundle installable instead of failing half-way through with a constraint error.
const TOOL_DEFAULTS = { base: 'AI', category: 'custom', type: 'custom', icon: 'fas fa-wrench', description: '', parameters: {}, outputs: {} };

async function write(kind, id, definition, ownerId) {
  if (kind === 'agent') return AgentModel.createOrUpdate(id, { ...definition, status: 'active' }, ownerId);
  if (kind === 'workflow') return WorkflowModel.createOrUpdate(id, JSON.stringify({ ...definition, id }), ownerId, false);
  if (kind === 'tool') return CustomToolModel.createOrUpdate(id, { ...TOOL_DEFAULTS, ...definition, isShareable: false }, ownerId);
  if (kind === 'skill') return SkillModel.createOrUpdate(id, { description: '', ...definition, isBuiltin: 0 }, ownerId);
  if (kind === 'widget') return writeWidget(id, definition, ownerId);
  if (kind === 'goal') return writeGoal(id, definition, ownerId);
  if (kind === 'workspace') return writeWorkspace(id, definition, ownerId);
  throw Object.assign(new Error('Unsupported item type'), { status: 400 });
}

async function customToolIds(ownerId) {
  return (await CustomToolModel.findAllByUserId(ownerId)).map(tool => tool.id);
}

/** Everything this owner could share, as {kind, id, name}. Names only: definitions are read on demand. */
async function list(ownerId) {
  const queries = [
    ['agent', 'SELECT id, name FROM agents WHERE created_by=?'],
    ['workflow', 'SELECT id, name FROM workflows WHERE user_id=?'],
    ['tool', 'SELECT id, title AS name FROM tools WHERE created_by=?'],
    ['skill', 'SELECT id, name FROM skills WHERE user_id=? AND COALESCE(is_builtin,0)=0'],
    ['widget', 'SELECT id, name FROM widget_definitions WHERE user_id=?'],
    ['goal', 'SELECT id, title AS name FROM goals WHERE user_id=? AND deleted_at IS NULL'],
    ['workspace', "SELECT page_id AS id, page_name AS name FROM widget_layouts WHERE user_id=? AND route LIKE 'workspace:%'"],
  ];
  const result = [];
  for (const [kind, sql] of queries) {
    // A table an older install never created is simply nothing to share.
    const rows = await all(sql, [ownerId]).catch(error => { if (/no such (table|column)/.test(error.message)) return []; throw error; });
    for (const row of rows) result.push({ kind, id: row.id, name: row.name || 'Untitled' });
  }
  return result;
}

export const nativeStore = Object.freeze({ read, write, customToolIds, list });

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
