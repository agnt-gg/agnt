/**
 * Backup → reset → restore, end to end, on the REAL schema with the ownership triggers installed.
 *
 * This is the promise the Settings screens make: take a backup, wipe the instance, and get your
 * work and history back exactly, owned by you, attached to the right parents, without touching
 * anyone else. Restoring twice must add nothing the second time.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { it, expect, vi } from 'vitest';
import db, { dbReady, dbPath } from '../models/database/index.js';
import { databaseRepository } from './authorization/ScopeRepository.js';
import { migrateOwnership } from './authorization/OwnershipMigration.js';
import { installOwnershipTriggers } from './authorization/OwnershipTriggers.js';
import { OWNERSHIP_INVENTORY } from './authorization/OwnershipInventory.js';
import { normalizeExportOptions, streamExport } from './DataExportService.js';
import { inspectBackup, restoreBackup } from './DataImportService.js';
import { summarizeReset, resetData, RESET_GROUPS } from './DataResetService.js';
import { openJobDatabase } from '../routes/DataRoutes.js';

const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, err => (err ? reject(err) : resolve())));
const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
const count = async (table, where, params) => (await get(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params)).n;
const A = 'rt-alice', B = 'rt-bob';

async function seed() {
  for (const id of [A, B]) await run('INSERT OR IGNORE INTO users(id,name) VALUES(?,?)', [id, id]);
  // Your work
  await run("INSERT INTO tools(id,base,title,category,type,icon,description,config,parameters,outputs,created_by) VALUES('rt-tool','AI','Summarize','custom','custom','fas fa-wrench','','{\"provider\":\"openai\"}','{}','{}',?)", [A]);
  await run("INSERT INTO skills(id,user_id,name,description,instructions,is_builtin) VALUES('rt-skill',?,'writing','Write well','Be clear',0)", [A]);
  await run("INSERT INTO skill_versions(id,skill_id,user_id,version,instructions) VALUES('rt-skill-v1','rt-skill',?,1,'Be clear')", [A]);
  await run("INSERT INTO workflows(id,user_id,name,status,workflow_data) VALUES('rt-flow',?,'Triage','listening','{\"nodes\":[],\"edges\":[]}')", [A]);
  await run("INSERT INTO workflow_versions(workflow_id,version_number,workflow_state,is_compressed) VALUES('rt-flow',1,'{\"nodes\":[]}',0)");
  await run("INSERT INTO agents(id,name,status,created_by,tools,workflows,skills) VALUES('rt-agent','Researcher','active',?,'[\"rt-tool\"]','[\"rt-flow\"]','[\"rt-skill\"]')", [A]);
  await run("INSERT INTO agent_resources(agent_id,credit_limit,credits_used) VALUES('rt-agent',1000,5)");
  await run("INSERT INTO agent_workflows(agent_id,workflow_id) VALUES('rt-agent','rt-flow')");
  await run("INSERT INTO widget_definitions(id,user_id,name,source_code) VALUES('rt-widget',?,'Clock','<div/>')", [A]);
  // History
  await run("INSERT INTO agent_memory(id,agent_id,user_id,memory_type,content) VALUES('rt-mem','rt-agent',?,'fact','likes tea')", [A]);
  await run("INSERT INTO conversation_logs(conversation_id,user_id,initial_prompt,full_history) VALUES('rt-conv',?,'hi','[]')", [A]);
  await run("INSERT INTO content_outputs(id,user_id,title,content) VALUES('rt-out',?,'report','# hi')", [A]);
  await run("INSERT INTO goals(id,user_id,title,description) VALUES('rt-goal',?,'ship','Ship it')", [A]);
  await run("INSERT INTO tasks(id,goal_id,title) VALUES('rt-task','rt-goal','first')");
  await run("INSERT INTO agent_executions(id,user_id,agent_id) VALUES('rt-exec',?,'rt-agent')", [A]);
  await run("INSERT INTO agent_tool_executions(id,execution_id,tool_name) VALUES('rt-call','rt-exec','web_search')");
  // Someone else, who must never be touched.
  await run("INSERT INTO agents(id,name,status,created_by) VALUES('rt-bob-agent','Bobs','active',?)", [B]);
  await run("INSERT INTO agent_memory(id,agent_id,user_id,memory_type,content) VALUES('rt-bob-mem','rt-bob-agent',?,'fact','bob')", [B]);
}

async function exportToFile(userId, file) {
  const res = new PassThrough();
  res.status = () => res; res.setHeader = () => {};
  const written = new Promise((resolve, reject) => res.pipe(fs.createWriteStream(file)).on('finish', resolve).on('error', reject));
  await streamExport({ userId, options: normalizeExportOptions({ categories: 'all', compress: true }), res });
  await written;
}

it('backs up, resets and restores a user exactly, and never touches anyone else', async () => {
  await dbReady;
  const repository = databaseRepository(db);
  await migrateOwnership(repository);
  await installOwnershipTriggers(repository, OWNERSHIP_INVENTORY);
  await seed();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-roundtrip-'));
  const file = path.join(dir, 'backup.json.gz');
  const jobDb = await openJobDatabase(dbPath);
  try {
    await exportToFile(A, file);
    const summary = await inspectBackup(file);
    const counted = Object.fromEntries(summary.categories.map(c => [c.id, c.count]));
    expect(summary.complete).toBe(true);
    expect(counted).toMatchObject({ tools: 1, skills: 1, workflows: 1, agents: 1, widgets: 1, memories: 1, conversations: 1, outputs: 1, goals: 1, traces: 1, workflowVersions: 1 });

    // Reset everything (except connections) for Alice. Her listening workflow is stopped first.
    const before = Object.fromEntries((await summarizeReset(jobDb, A)).map(g => [g.id, g.count]));
    expect(before.work).toBeGreaterThanOrEqual(5);
    const stopWorkflow = vi.fn(async () => {});
    const groups = RESET_GROUPS.filter(g => g.id !== 'connections').map(g => g.id);
    await resetData({ db: jobDb, userId: A, groups, stopWorkflow });
    expect(stopWorkflow).toHaveBeenCalledWith('rt-flow');
    for (const [table, column] of [['agents', 'created_by'], ['tools', 'created_by'], ['workflows', 'user_id'], ['agent_memory', 'user_id'], ['conversation_logs', 'user_id'], ['goals', 'user_id']]) {
      expect(await count(table, `${column} = ?`, [A])).toBe(0);
    }
    for (const [table, where] of [['agent_tool_executions', "id='rt-call'"], ['tasks', "id='rt-task'"], ['skill_versions', "id='rt-skill-v1'"], ['agent_resources', "agent_id='rt-agent'"], ['workflow_versions', "workflow_id='rt-flow'"]]) {
      expect(await count(table, where, [])).toBe(0);
    }
    expect(await count('agents', 'id = ?', ['rt-bob-agent'])).toBe(1);
    expect(await count('agent_memory', 'id = ?', ['rt-bob-mem'])).toBe(1);

    // Restore everything.
    const all = summary.categories.map(c => c.id);
    const first = await restoreBackup({ filePath: file, userId: A, categories: all, db: jobDb });
    expect(first.problems).toEqual([]);
    for (const id of ['tools', 'skills', 'workflows', 'agents', 'widgets', 'memories', 'conversations', 'outputs', 'goals', 'traces', 'workflowVersions']) {
      expect(first.results[id]).toMatchObject({ added: 1, skipped: 0 });
    }
    const agent = await get("SELECT created_by, tools, scope_id FROM agents WHERE id='rt-agent'");
    expect(agent.created_by).toBe(A);
    expect(JSON.parse(agent.tools)).toEqual(['rt-tool']);
    expect(agent.scope_id).toBeTruthy();
    expect((await get("SELECT status FROM workflows WHERE id='rt-flow'")).status).toBe('stopped');
    for (const [table, where] of [['agent_tool_executions', "id='rt-call' AND execution_id='rt-exec'"], ['tasks', "id='rt-task' AND goal_id='rt-goal'"], ['skill_versions', "id='rt-skill-v1'"], ['agent_resources', "agent_id='rt-agent' AND credit_limit=1000"], ['agent_workflows', "agent_id='rt-agent' AND workflow_id='rt-flow'"], ['workflow_versions', "workflow_id='rt-flow' AND version_number=1"]]) {
      expect(await count(table, where, [])).toBe(1);
    }

    // Restoring the same file again adds nothing.
    const second = await restoreBackup({ filePath: file, userId: A, categories: all, db: jobDb });
    expect(Object.values(second.results).every(r => r.added === 0)).toBe(true);
    expect(await count('conversation_logs', "user_id = ? AND conversation_id='rt-conv'", [A])).toBe(1);
    expect(await count('workflow_versions', "workflow_id='rt-flow'", [])).toBe(1);
    expect(await count('agent_workflows', "agent_id='rt-agent'", [])).toBe(1);

    // Bob restoring Alice's file gets nothing of hers attached to him, and changes nothing of hers.
    const bob = await restoreBackup({ filePath: file, userId: B, categories: ['agents', 'traces', 'workflowVersions'], db: jobDb });
    expect(bob.results.agents).toMatchObject({ added: 0, skipped: 1 });
    expect(bob.results.workflowVersions).toMatchObject({ added: 0, skipped: 1 });
    expect((await get("SELECT created_by FROM agents WHERE id='rt-agent'")).created_by).toBe(A);
    expect(await count('agent_tool_executions', "execution_id='rt-exec'", [])).toBe(1);
  } finally {
    await new Promise(resolve => jobDb.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}, 60000);

it('refuses a file that is not an AGNT backup, and reports a damaged one by line', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agnt-badbackup-'));
  try {
    const notBackup = path.join(dir, 'notes.json');
    fs.writeFileSync(notBackup, '{"hello":"world"}\n');
    await expect(inspectBackup(notBackup)).rejects.toMatchObject({ status: 400, message: 'This is not an AGNT backup file.' });
    const damaged = path.join(dir, 'damaged.json');
    fs.writeFileSync(damaged, '{"format":"agnt-data-export","version":1,"categories":["memories"],\n"memories":[\n{"id":"x",\n');
    await expect(inspectBackup(damaged)).rejects.toMatchObject({ status: 400, message: 'The backup is damaged near line 3.' });
    const future = path.join(dir, 'future.json');
    fs.writeFileSync(future, '{"format":"agnt-data-export","version":99,"categories":[],\n"counts":{},\n"complete":true\n}\n');
    await expect(inspectBackup(future)).rejects.toMatchObject({ status: 400 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
