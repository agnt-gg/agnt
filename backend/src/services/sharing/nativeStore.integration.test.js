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
