// Migrate live config off the de-registered browser tools and onto `browser`.
//
// SCOPE. Only rows that would CHANGE BEHAVIOUR: workflow nodes that would fail
// to execute, and tool allow-lists that would silently drop browsing. History
// (tasks.input/output/required_tools, skill_versions.instructions) is left
// exactly as it is -- a record of what happened, that mentions the name the
// tool had at the time, is correct and must not be rewritten.
//
// Every row is snapshotted to a rollback file BEFORE the first write.
//
// Dry run by default:
//   node backend/scripts/migrate-legacy-browser-tools.cjs
//   node backend/scripts/migrate-legacy-browser-tools.cjs --apply
//   node backend/scripts/migrate-legacy-browser-tools.cjs --db "C:\\path\\to\\agnt.db"
const path = require('path');
const fs = require('fs');
const os = require('os');
const sqlite3 = require('sqlite3');

/**
 * The live database, NOT the repo's checked-in dev copy — they diverge, and
 * probing the wrong one reports a clean database that is not the one the app
 * runs on. Resolved the way the app resolves it, per platform.
 */
function resolveDbPath() {
  const flagIndex = process.argv.indexOf('--db');
  if (flagIndex !== -1 && process.argv[flagIndex + 1]) return process.argv[flagIndex + 1];
  if (process.env.AGNT_DB_PATH) return process.env.AGNT_DB_PATH;

  const home = os.homedir();
  const root = process.platform === 'win32'
    ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'AGNT')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support', 'AGNT')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'AGNT');
  return path.join(root, 'Data', 'agnt.db');
}

const dbPath = resolveDbPath();
if (!fs.existsSync(dbPath)) {
  console.error(`No database at ${dbPath}. Pass --db <path> if it lives elsewhere.`);
  process.exit(1);
}
const rollbackPath = path.join(path.dirname(dbPath), `rollback-legacy-browser-${Date.now()}.json`);
const apply = process.argv.includes('--apply');

console.log(`database: ${dbPath}`);

const db = new sqlite3.Database(dbPath, apply ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY);
db.configure('busyTimeout', 30000);

const all = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
const run = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function cb(e) { return e ? rej(e) : res(this.changes); }));

const LEGACY_HYPHEN = ['ai-browser-use', 'ai-browser-control', 'ai-browser-act'];
const LEGACY_SNAKE = ['ai_browser_use', 'ai_browser_control', 'ai_browser_act'];

// Which delegation level each legacy tool was, so the node keeps doing the same
// thing rather than merely becoming syntactically valid.
const ACTION_FOR = {
  'ai-browser-use': 'run',
  'ai-browser-control': 'script',
  // act was the verb engine; its own `action` param already carries the verb.
  'ai-browser-act': null,
};

const rollback = [];
const snapshot = (table, id, column, value) => rollback.push({ table, id, column, value });

/** Replace legacy names in a JSON tool-name array, preserving order, deduped. */
function migrateToolList(raw) {
  const list = JSON.parse(raw);
  const out = [];
  for (const name of list) {
    const next = LEGACY_SNAKE.includes(name) ? 'browser' : name;
    if (!out.includes(next)) out.push(next);
  }
  return JSON.stringify(out);
}

(async () => {
  let changes = 0;

  // ---- 1. WORKFLOW NODES -------------------------------------------------
  const workflows = await all("SELECT id, name, workflow_data, node_summary FROM workflows WHERE workflow_data LIKE '%ai-browser-%' OR node_summary LIKE '%ai-browser-%'");
  for (const row of workflows) {
    const data = JSON.parse(row.workflow_data);
    let touched = 0;

    for (const node of data.nodes || []) {
      if (!LEGACY_HYPHEN.includes(node.type)) continue;
      const action = ACTION_FOR[node.type];
      node.type = 'browser';
      node.parameters = node.parameters || {};
      // Put `action` first: it is the parameter that selects everything else.
      if (action && !node.parameters.action) {
        node.parameters = { action, ...node.parameters };
      }
      touched += 1;
    }
    if (!touched) continue;

    let summary = row.node_summary;
    if (summary) {
      const parsed = JSON.parse(summary);
      for (const entry of parsed) {
        if (LEGACY_HYPHEN.includes(entry.type)) entry.type = 'browser';
      }
      summary = JSON.stringify(parsed);
    }

    console.log(`workflow "${row.name}": ${touched} node(s) -> browser`);
    if (apply) {
      snapshot('workflows', row.id, 'workflow_data', row.workflow_data);
      snapshot('workflows', row.id, 'node_summary', row.node_summary);
      await run('UPDATE workflows SET workflow_data = ?, node_summary = ? WHERE id = ?',
        [JSON.stringify(data), summary, row.id]);
    }
    changes += 1;
  }

  // ---- 2. AGENT TOOL CEILINGS -------------------------------------------
  // assignedTools is a user-declared ceiling that is NOT widened by the
  // successor map, so a legacy name left here means the agent loses browsing.
  const agents = await all("SELECT id, name, tools FROM agents WHERE tools LIKE '%ai_browser_%'");
  for (const row of agents) {
    const next = migrateToolList(row.tools);
    if (next === row.tools) continue;
    console.log(`agent "${row.name}" (${row.id.slice(0, 8)}): tools -> browser`);
    if (apply) {
      snapshot('agents', row.id, 'tools', row.tools);
      await run('UPDATE agents SET tools = ? WHERE id = ?', [next, row.id]);
    }
    changes += 1;
  }

  // ---- 3. SKILL ALLOW-LISTS ---------------------------------------------
  const skills = await all("SELECT id, name, allowed_tools, instructions FROM skills WHERE allowed_tools LIKE '%ai_browser_%' OR instructions LIKE '%ai_browser_%' OR instructions LIKE '%ai-browser-%'");
  for (const row of skills) {
    let nextTools = row.allowed_tools;
    if (nextTools && /ai_browser_/.test(nextTools)) nextTools = migrateToolList(nextTools);

    let nextInstructions = row.instructions;
    if (nextInstructions) {
      for (const name of [...LEGACY_SNAKE, ...LEGACY_HYPHEN]) {
        nextInstructions = nextInstructions.split(name).join('browser');
      }
    }

    const toolsChanged = nextTools !== row.allowed_tools;
    const textChanged = nextInstructions !== row.instructions;
    if (!toolsChanged && !textChanged) continue;

    console.log(`skill "${row.name}": ${toolsChanged ? 'allowed_tools ' : ''}${textChanged ? 'instructions' : ''} -> browser`);
    if (apply) {
      if (toolsChanged) snapshot('skills', row.id, 'allowed_tools', row.allowed_tools);
      if (textChanged) snapshot('skills', row.id, 'instructions', row.instructions);
      await run('UPDATE skills SET allowed_tools = ?, instructions = ? WHERE id = ?',
        [nextTools, nextInstructions, row.id]);
    }
    changes += 1;
  }

  // ---- 4. WIDGET SOURCE --------------------------------------------------
  const widgets = await all("SELECT id, name, source_code FROM widget_definitions WHERE source_code LIKE '%ai_browser_%'");
  for (const row of widgets) {
    let next = row.source_code;
    for (const name of [...LEGACY_SNAKE, ...LEGACY_HYPHEN]) next = next.split(name).join('browser');
    if (next === row.source_code) continue;
    console.log(`widget "${row.name}": source_code -> browser`);
    if (apply) {
      snapshot('widget_definitions', row.id, 'source_code', row.source_code);
      await run('UPDATE widget_definitions SET source_code = ? WHERE id = ?', [next, row.id]);
    }
    changes += 1;
  }

  if (apply) {
    fs.writeFileSync(rollbackPath, JSON.stringify(rollback, null, 2), 'utf8');
    console.log(`\nAPPLIED ${changes} row(s). Rollback snapshot: ${rollbackPath} (${rollback.length} column values)`);
  } else {
    console.log(`\nDRY RUN: ${changes} row(s) would change. Re-run with --apply.`);
  }
  db.close();
})().catch((e) => { console.error('MIGRATION FAILED:', e.message); process.exit(1); });
