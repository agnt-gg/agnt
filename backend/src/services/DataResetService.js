import { OWNERSHIP_INVENTORY } from './authorization/OwnershipInventory.js';

/**
 * DataResetService: clear parts of a user's AGNT back to a fresh start.
 *
 * Every delete is scoped to ONE user through the ownership inventory's owner column, and
 * child rows (a trace's tool calls, a goal's tasks, a skill's versions...) are found through
 * the inventory's parent links and deleted first, deepest level first. Nothing here is
 * table-by-table guesswork: a table the inventory does not know is never touched.
 *
 * Deletes run in small chunks on the job's own connection, so a reset of millions of rows
 * never holds the write lock long enough to stall the running app.
 *
 * Never reset, in any group: the account itself, billing (transactions, wallets, contracts)
 * and usage statistics. Those are records, not preferences.
 */

export const RESET_GROUPS = Object.freeze([
  {
    id: 'chats',
    label: 'Chats and outputs',
    description: 'Every conversation, chat folder and generated output.',
    tables: ['conversation_logs', 'content_outputs', 'groups', 'conversation_settings', 'conversation_prompt_state', 'codex_threads'],
  },
  {
    id: 'history',
    label: 'Run history',
    description: 'Agent traces, workflow runs, model calls and routing decisions.',
    tables: ['agent_executions', 'workflow_executions', 'llm_calls', 'routing_decisions', 'extraction_gate'],
  },
  {
    id: 'memory',
    label: 'Memory and insights',
    description: 'What your agents remember, and what AGNT learned from past runs.',
    tables: ['agent_memory', 'insights', 'golden_standards', 'evolution_performance_snapshots', 'evolution_core_runs', 'mutation_history'],
  },
  {
    id: 'work',
    label: 'Agents, workflows and tools',
    description: 'Everything you built: agents, workflows, custom tools, skills, widgets, goals and schedules. Running workflows are stopped first.',
    tables: ['agents', 'workflows', 'tools', 'skills', 'widget_definitions', 'goals', 'schedules', 'webhooks', 'experiments', 'eval_datasets'],
  },
  {
    id: 'preferences',
    label: 'Layout and preferences',
    description: 'Dashboards, theme, navigation, sounds and assistant settings go back to their defaults.',
    tables: ['widget_layouts', 'skillforge_settings', 'evolution_settings'],
    // The browser-side half (theme, navigation, sounds, tours) is cleared by the client.
    client: true,
  },
  {
    id: 'connections',
    label: 'Connected accounts and API keys',
    description: 'Disconnects every account and removes every stored API key. You will need to connect them again.',
    tables: ['oauth_tokens', 'api_keys', 'custom_openai_providers'],
    danger: true,
  },
]);
export const RESET_CONFIRMATION = 'RESET';

const GROUP_BY_ID = new Map(RESET_GROUPS.map(group => [group.id, group]));
const PERSONAL = new Map(OWNERSHIP_INVENTORY.filter(entry => entry.kind === 'personal').map(entry => [entry.table, entry]));
const CHILDREN = OWNERSHIP_INVENTORY.filter(entry => entry.kind === 'inherited');
/** Extra conditions: built-in skills are part of AGNT, not the user's work. */
const EXTRA_CONDITION = { skills: 'COALESCE(is_builtin, 0) = 0' };
const CHUNK = 2000;
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

// Every table named above must be a personal table the ownership inventory knows. Checked at load.
for (const group of RESET_GROUPS) {
  for (const table of group.tables) if (!PERSONAL.has(table)) throw new Error(`Reset group ${group.id} names ${table}, which has no owner in the ownership inventory`);
}

export function normalizeResetRequest({ groups, confirm } = {}) {
  const fail = message => Object.assign(new Error(message), { status: 400 });
  if (!Array.isArray(groups) || !groups.length) throw fail('Choose at least one thing to reset');
  const unknown = groups.filter(id => !GROUP_BY_ID.has(id));
  if (unknown.length) throw fail(`Unknown reset option: ${unknown.join(', ')}`);
  if (confirm !== RESET_CONFIRMATION) throw fail(`Type ${RESET_CONFIRMATION} to confirm`);
  return RESET_GROUPS.filter(group => groups.includes(group.id)).map(group => group.id);
}

function connection(db) {
  return {
    run: (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function done(err) { return err ? reject(err) : resolve({ changes: this.changes }); })),
    get: (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || null)))),
    all: (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])))),
  };
}

async function existingTables(sql) {
  return new Set((await sql.all("SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name));
}

function ownedCondition(table) {
  const { ownerColumn } = PERSONAL.get(table);
  return [`"${ownerColumn}" = ?`, EXTRA_CONDITION[table]].filter(Boolean).join(' AND ');
}

/** Rows each group would remove for this user, counting the top-level items only. */
export async function summarizeReset(db, userId) {
  const sql = connection(db);
  const tables = await existingTables(sql);
  const counts = {};
  for (const group of RESET_GROUPS) {
    let total = 0;
    for (const table of group.tables) {
      if (!tables.has(table)) continue;
      total += (await sql.get(`SELECT COUNT(*) AS n FROM "${table}" WHERE ${ownedCondition(table)}`, [userId]))?.n || 0;
    }
    counts[group.id] = total;
  }
  return RESET_GROUPS.map(({ id, label, description, danger = false, client = false }) => ({ id, label, description, danger, client, count: counts[id] }));
}

/**
 * Delete rows of `table` matching `condition` (with `params`), after every child table that
 * hangs off it, recursively. Returns rows removed.
 */
async function deleteTree(sql, tables, table, condition, params) {
  let removed = 0;
  for (const child of CHILDREN.filter(entry => entry.parentTable === table)) {
    if (!tables.has(child.table) || !IDENTIFIER.test(child.parentColumn)) continue;
    removed += await deleteTree(sql, tables, child.table, `"${child.parentColumn}" IN (SELECT id FROM "${table}" WHERE ${condition})`, params);
  }
  for (;;) {
    const { changes } = await sql.run(`DELETE FROM "${table}" WHERE rowid IN (SELECT rowid FROM "${table}" WHERE ${condition} LIMIT ${CHUNK})`, params);
    removed += changes;
    if (changes < CHUNK) break;
  }
  return removed;
}

/**
 * Reset the chosen groups for `userId`. `stopWorkflow(id)` is called for each of the user's
 * running workflows before their definitions are removed, so no listener outlives its workflow.
 */
export async function resetData({ db, userId, groups, stopWorkflow = async () => {}, onProgress = () => {} }) {
  if (!userId) throw new Error('resetData requires userId');
  const sql = connection(db);
  await sql.run('PRAGMA busy_timeout = 10000');
  const tables = await existingTables(sql);
  const removed = {};
  const problems = [];
  if (groups.includes('work') && tables.has('workflows')) {
    const running = await sql.all("SELECT id FROM workflows WHERE user_id = ? AND status IN ('listening','running','queued')", [userId]);
    for (const { id } of running) {
      try { await stopWorkflow(id); } catch (err) { problems.push(`Could not stop a running workflow before removing it: ${err.message}`); }
    }
  }
  for (const groupId of groups) {
    const group = GROUP_BY_ID.get(groupId);
    let total = 0;
    for (const table of group.tables) {
      if (!tables.has(table)) continue;
      onProgress({ group: groupId, table });
      total += await deleteTree(sql, tables, table, ownedCondition(table), [userId]);
    }
    removed[groupId] = total;
  }
  return { removed, problems };
}

export default { RESET_GROUPS, RESET_CONFIRMATION, normalizeResetRequest, summarizeReset, resetData };
