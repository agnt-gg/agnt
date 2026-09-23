import { it, expect } from 'vitest';
import db, { dbReady } from '../../models/database/index.js';
import AgentModel from '../../models/AgentModel.js';
import CustomToolModel from '../../models/CustomToolModel.js';
import WorkflowModel from '../../models/WorkflowModel.js';
import { nativeStore, nodeProvider } from './nativeStore.js';
import { buildBundle, installBundle } from './TeamBundle.js';

const run = (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, error => (error ? reject(error) : resolve())));
const SECRET = ['sk', 'proj', 'z'.repeat(40)].join('-');

it('copies a real agent with its tool and workflow through the models, owner-checked both ways', async () => {
  await dbReady;
  for (const id of ['share-alice', 'share-bob', 'scope:share-team']) await run('INSERT OR IGNORE INTO users(id,name) VALUES(?,?)', [id, id]);
  await CustomToolModel.createOrUpdate('share-tool', { title: 'Summarize', base: 'AI', type: 'custom', category: 'custom', icon: 'fas fa-compress', description: 'Summarize text', config: { instructions: 'Summarize', provider: 'openai' }, parameters: {}, outputs: {} }, 'share-alice');
  await WorkflowModel.createOrUpdate('share-flow', JSON.stringify({ id: 'share-flow', name: 'Triage', nodes: [{ id: 'n1', type: 'github-api', parameters: { action: 'GET_REPO_INFO' } }], edges: [] }), 'share-alice', false);
  await AgentModel.createOrUpdate('share-agent', { name: 'Researcher', status: 'active', provider: 'openai', model: 'gpt-4o', systemPrompt: 'Never paste ' + SECRET, assignedTools: ['share-tool'], assignedWorkflows: ['share-flow'], assignedSkills: [] }, 'share-alice');

  // Not Bob's: indistinguishable from missing.
  await expect(buildBundle(nativeStore, 'share-bob', [{ kind: 'agent', id: 'share-agent' }])).rejects.toMatchObject({ status: 404 });

  const { bundle, preview } = await buildBundle(nativeStore, 'share-alice', [{ kind: 'agent', id: 'share-agent' }], { nodeProvider });
  expect(bundle.items.map(item => item.kind).sort()).toEqual(['agent', 'tool', 'workflow']);
  expect(JSON.stringify(bundle)).not.toContain(SECRET);
  expect(preview.needs.map(need => need.provider).sort()).toEqual(['github', 'openai']);

  const { installed } = await installBundle(nativeStore, 'scope:share-team', bundle);
  const ids = Object.fromEntries(installed.map(item => [item.kind, item.id]));
  const agent = await AgentModel.findOne(ids.agent);
  expect(agent).toMatchObject({ name: 'Researcher', created_by: 'scope:share-team', provider: 'openai' });
  expect(agent.assignedTools).toEqual([ids.tool]);
  expect(agent.assignedWorkflows).toEqual([ids.workflow]);
  expect((await CustomToolModel.findOne(ids.tool)).created_by).toBe('scope:share-team');
  expect((await WorkflowModel.findOne(ids.workflow)).user_id).toBe('scope:share-team');
  // A sparse bundle (no icon, no description) still installs with schema-safe defaults.
  const sparse = await installBundle(nativeStore, 'scope:share-team', { version: 1, items: [{ kind: 'tool', sourceId: 'bare', definition: { title: 'Bare tool' } }] });
  expect(await CustomToolModel.findOne(sparse.installed[0].id)).toMatchObject({ title: 'Bare tool', icon: 'fas fa-wrench', created_by: 'scope:share-team' });
  // The original is untouched and still Alice's.
  expect((await AgentModel.findOne('share-agent')).created_by).toBe('share-alice');
}, 30000);

const get = (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (error, row) => (error ? reject(error) : resolve(row))));
const all = (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (error, rows) => (error ? reject(error) : resolve(rows))));

it('copies a workspace with its custom widget, and a goal with its plan, through the real tables', async () => {
  await dbReady;
  for (const id of ['board-alice', 'scope:board-team']) await run('INSERT OR IGNORE INTO users(id,name) VALUES(?,?)', [id, id]);
  await run("INSERT OR REPLACE INTO widget_definitions (id,user_id,name,widget_type,source_code,config) VALUES ('cw_b0a4d0000001','board-alice','KPI board','html','<b>ok</b>','{\"refresh\":30}')");
  const layout = JSON.stringify({ widgets: [{ instanceId: 'w1', widgetId: 'cw_b0a4d0000001', col: 0, row: 0, cols: 4, rows: 3, history: ['x'] }, { instanceId: 'w2', widgetId: 'workspace-chat', chatKey: '', col: 4, row: 0, cols: 3, rows: 8 }], channelConversations: { 'workspace:ws_board': 'conv-private' }, updatedAt: 1 });
  await run("INSERT OR REPLACE INTO widget_layouts (id,user_id,page_id,page_name,route,layout_data) VALUES ('layout-board','board-alice','ws_board','Launch room','workspace:ws_board',?)", [layout]);
  await AgentModel.createOrUpdate('board-agent', { name: 'Planner', status: 'active', provider: 'openai', model: 'gpt-4o', systemPrompt: 'Plan', assignedTools: [], assignedWorkflows: [], assignedSkills: [] }, 'board-alice');
  await run("INSERT OR REPLACE INTO goals (id,user_id,title,description,status) VALUES ('board-goal','board-alice','Ship v2','Launch it','executing')");
  await run("INSERT OR REPLACE INTO tasks (id,goal_id,title,description,agent_id,order_index,status,output) VALUES ('bt1','board-goal','Plan','Write the plan','board-agent',0,'completed','private output')");
  await run("INSERT OR REPLACE INTO tasks (id,goal_id,parent_task_id,title,description,dependencies,order_index,status) VALUES ('bt2','board-goal','bt1','Build','Build it','[\"bt1\"]',1,'pending')");

  const listed = await nativeStore.list('board-alice');
  expect(listed).toEqual(expect.arrayContaining([{ kind: 'widget', id: 'cw_b0a4d0000001', name: 'KPI board' }, { kind: 'workspace', id: 'ws_board', name: 'Launch room' }, { kind: 'goal', id: 'board-goal', name: 'Ship v2' }]));

  const { bundle } = await buildBundle(nativeStore, 'board-alice', [{ kind: 'workspace', id: 'ws_board' }, { kind: 'goal', id: 'board-goal' }]);
  expect(JSON.stringify(bundle)).not.toMatch(/conv-private|private output|executing/);
  const { installed } = await installBundle(nativeStore, 'scope:board-team', bundle);
  const id = kind => installed.find(item => item.kind === kind).id;

  const widget = await get('SELECT * FROM widget_definitions WHERE id=?', [id('widget')]);
  expect(widget).toMatchObject({ user_id: 'scope:board-team', name: 'KPI board', source_code: '<b>ok</b>' });
  const row = await get("SELECT * FROM widget_layouts WHERE user_id='scope:board-team' AND route=?", ['workspace:' + id('workspace')]);
  const copied = JSON.parse(row.layout_data);
  expect(copied.widgets.map(w => w.widgetId)).toEqual([id('widget'), 'workspace-chat']);
  expect(copied.channelConversations).toEqual({});
  expect(copied.widgets[0].history).toBeUndefined();

  const goal = await get('SELECT * FROM goals WHERE id=?', [id('goal')]);
  expect(goal).toMatchObject({ user_id: 'scope:board-team', title: 'Ship v2', status: 'planning' });
  const tasks = await all('SELECT * FROM tasks WHERE goal_id=? ORDER BY order_index', [id('goal')]);
  expect(tasks.map(t => [t.title, t.status, t.output ?? null])).toEqual([['Plan', 'assigned', null], ['Build', 'pending', null]]);
  expect(tasks[0].agent_id).toBe(id('agent'));
  expect(tasks[1].parent_task_id).toBe(tasks[0].id);
  expect(JSON.parse(tasks[1].dependencies)).toEqual([tasks[0].id]);

  // A task pointing at an agent the receiver does not have is kept, unassigned, rather than failing the install.
  const { installed: bare } = await installBundle(nativeStore, 'scope:board-team', { version: 1, items: [{ kind: 'goal', sourceId: 'g', definition: { title: 'Solo', tasks: [{ title: 'Do it', agentId: 'someone-elses-agent' }] } }] });
  expect((await get('SELECT agent_id, status FROM tasks WHERE goal_id=?', [bare[0].id]))).toEqual({ agent_id: null, status: 'pending' });
}, 30000);
