import {it,expect} from 'vitest';
import db,{dbReady} from '../../models/database/index.js';
import {databaseRepository,ensureSharedScope} from './ScopeRepository.js';
import {migrateOwnership} from './OwnershipMigration.js';
import {OWNERSHIP_INVENTORY} from './OwnershipInventory.js';
import {installOwnershipTriggers} from './OwnershipTriggers.js';
import AgentModel from '../../models/AgentModel.js';import ToolModel from '../../models/CustomToolModel.js';import WorkflowModel from '../../models/WorkflowModel.js';
it('native model create/update/list works with shared ownership and remains private outside the scope',async()=>{
 await dbReady;const r=databaseRepository(db);await migrateOwnership(r);await installOwnershipTriggers(r,OWNERSHIP_INVENTORY);
 const first=await ensureSharedScope(r,'t','a'),second=await ensureSharedScope(r,'t','b');
 await AgentModel.createOrUpdate('shared-agent',{name:'Agent',status:'active',provider:'groq',model:'model',assignedTools:[]},first.resourceOwnerId);
 await AgentModel.createOrUpdate('shared-agent',{name:'Updated',status:'active',provider:'groq',model:'model',assignedTools:[]},first.resourceOwnerId);
 expect((await AgentModel.findAllByUserId(first.resourceOwnerId))[0].name).toBe('Updated');expect(await AgentModel.findAllByUserId(second.resourceOwnerId)).toEqual([]);
 await ToolModel.createOrUpdate('shared-tool',{title:'Tool',base:'AI',category:'custom',type:'team-test',icon:'tool',description:'test',parameters:{},outputs:{},config:{instructions:'Test'}},first.resourceOwnerId);
 await WorkflowModel.createOrUpdate('shared-workflow',JSON.stringify({nodes:[],edges:[]}),first.resourceOwnerId,false);
 for(const table of ['agents','tools','workflows'])expect((await r.get(`SELECT scope_id FROM ${table} LIMIT 1`)).scope_id).toBe(first.id);
 await expect(WorkflowModel.createOrUpdate('shared-workflow','{}',second.resourceOwnerId,false)).rejects.toMatchObject({status:404});
},30000);
