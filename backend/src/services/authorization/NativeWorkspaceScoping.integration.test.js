import {it,expect} from 'vitest';
import db,{dbReady} from '../../models/database/index.js';
import {databaseRepository,ensureSharedScope} from './ScopeRepository.js';
import {migrateOwnership} from './OwnershipMigration.js';
import {installOwnershipTriggers} from './OwnershipTriggers.js';
import {OWNERSHIP_INVENTORY} from './OwnershipInventory.js';
import AgentModel from '../../models/AgentModel.js';
import WorkflowModel from '../../models/WorkflowModel.js';
import ContentOutputModel from '../../models/ContentOutputModel.js';
import WorkflowVersionService from '../WorkflowVersionService.js';

/** Real native models under two cloud workspace scopes: list, search, versions,
 * bulk mutation and per-workspace file storage must not cross the boundary. */
it('keeps native lists, search, versions, bulk writes and files inside their workspace',async()=>{
 await dbReady;const r=databaseRepository(db);
 await migrateOwnership(r);await installOwnershipTriggers(r,OWNERSHIP_INVENTORY);
 const one=await ensureSharedScope(r,'scoping-team','workspace-one');
 const two=await ensureSharedScope(r,'scoping-team','workspace-two');
 expect(one.resourceOwnerId).not.toBe(two.resourceOwnerId);

 const agent=kind=>({name:'Shared '+kind,status:'active',provider:'groq',model:'m',assignedTools:[],assignedWorkflows:[],assignedSkills:[]});
 await AgentModel.createOrUpdate('scope-one-agent',agent('one'),one.resourceOwnerId);
 await AgentModel.createOrUpdate('scope-two-agent',agent('two'),two.resourceOwnerId);
 await WorkflowModel.createOrUpdate('scope-one-workflow',JSON.stringify({name:'Shared term',nodes:[],edges:[]}),one.resourceOwnerId,false);
 await WorkflowModel.createOrUpdate('scope-two-workflow',JSON.stringify({name:'Shared term',nodes:[],edges:[]}),two.resourceOwnerId,false);

 // LIST: each workspace sees only its own rows.
 expect((await AgentModel.findAllByUserId(one.resourceOwnerId)).map(a=>a.id)).toEqual(['scope-one-agent']);
 expect((await AgentModel.findAllByUserId(two.resourceOwnerId)).map(a=>a.id)).toEqual(['scope-two-agent']);

 // SEARCH: an identical term in both workspaces returns one row per scope.
 const search=async owner=>r.all("SELECT id FROM workflows WHERE user_id=? AND instr(lower(name),'shared term')>0",[owner]);
 expect((await search(one.resourceOwnerId)).map(row=>row.id)).toEqual(['scope-one-workflow']);
 expect((await search(two.resourceOwnerId)).map(row=>row.id)).toEqual(['scope-two-workflow']);
 const outputs=async owner=>(await ContentOutputModel.findAllByUserId(owner)).outputs.map(row=>row.id);
 await r.run("INSERT INTO content_outputs(id,user_id,title,content,content_type) VALUES('scope-one-output',?,'Shared term','c','markdown')",[one.resourceOwnerId]);
 expect(await outputs(one.resourceOwnerId)).toEqual(['scope-one-output']);
 expect(await outputs(two.resourceOwnerId)).toEqual([]);

 // VERSIONS: history is reachable only through the owning workspace's workflow.
 await WorkflowVersionService.createVersion({workflowId:'scope-one-workflow',workflowState:{nodes:[],edges:[]},createdBy:one.resourceOwnerId});
 const versions=await WorkflowVersionService.getVersionHistory('scope-one-workflow');
 expect(versions.length).toBeGreaterThan(0);
 const scoped=await r.get('SELECT v.scope_id AS version_scope,w.scope_id AS workflow_scope FROM workflow_versions v JOIN workflows w ON w.id=v.workflow_id WHERE v.workflow_id=?',['scope-one-workflow']);
 expect(scoped.version_scope).toBe(scoped.workflow_scope);
 expect(scoped.version_scope).toBe(one.id);
 expect(await r.all('SELECT id FROM workflow_versions WHERE scope_id=?',[two.id])).toEqual([]);

 // BULK: a bulk mutation addressed with the other workspace's owner changes nothing.
 await r.run("INSERT INTO groups(id,user_id,name) VALUES('scope-one-group',?,'Group')",[one.resourceOwnerId]);
 const rejected=await ContentOutputModel.bulkMoveToGroup(['scope-one-output'],two.resourceOwnerId,'scope-one-group');
 expect(rejected?.changes ?? 0).toBe(0);
 expect((await r.get("SELECT group_id FROM content_outputs WHERE id='scope-one-output'")).group_id).toBeNull();
 await ContentOutputModel.bulkMoveToGroup(['scope-one-output'],one.resourceOwnerId,'scope-one-group');
 expect((await r.get("SELECT group_id FROM content_outputs WHERE id='scope-one-output'")).group_id).toBe('scope-one-group');

 // OWNERSHIP IS PINNED: a write cannot relabel a row into the other workspace.
 await expect(r.run("UPDATE agents SET created_by=? WHERE id='scope-one-agent'",[two.resourceOwnerId])).rejects.toThrow(/immutable/);
 await expect(WorkflowModel.createOrUpdate('scope-one-workflow','{}',two.resourceOwnerId,false)).rejects.toMatchObject({status:404});

 // FILES: the cloud file adapter partitions storage by team+tenant+workspace.
 const {WorkspaceFileService}=await import('../WorkspaceFileService.js');
 const fs=await import('node:fs/promises');const path=await import('node:path');const os=await import('node:os');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'agnt-scoping-files-'));
 try{
  const files=new WorkspaceFileService({root,authorize:async()=>{}});
  const context={teamId:'scoping-team',tenantSlug:'tenant',workspaceId:'workspace-one'};
  await files.write(context,'notes.txt',Buffer.from('workspace one only'));
  expect((await files.read(context,'notes.txt')).toString()).toBe('workspace one only');
  await expect(files.read({...context,workspaceId:'workspace-two'},'notes.txt')).rejects.toBeTruthy();
 }finally{await fs.rm(root,{recursive:true,force:true});}
},120000);
