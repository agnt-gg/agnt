import {OWNERSHIP_INVENTORY} from './OwnershipInventory.js';
const descriptors=new Map(OWNERSHIP_INVENTORY.map(value=>[value.table,value]));
const actions=new Set(['view','edit','run','delete','manage_access']);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
/** All SQL identifiers originate in the reviewed registry, never in request values. */
export class ResourceAuthorization {
 constructor(repository,authorizeTeam){this.repository=repository;this.authorizeTeam=authorizeTeam;}
 async resolve(table,id,visited=new Set()){
  const descriptor=descriptors.get(table);
  if(!descriptor||descriptor.kind==='system')fail(403,'Resource type is not user accessible');
  if(visited.has(table))throw new Error('Cyclic resource ownership');visited.add(table);
  const row=await this.repository.get(`SELECT * FROM "${table}" WHERE id=?`,[id]);
  if(!row)fail(404,'Resource not found');
  if(row.scope_id){const scope=await this.repository.get('SELECT * FROM ownership_scopes WHERE id=?',[row.scope_id]);if(!scope)fail(403,'Resource ownership is unresolved');return{row,scope};}
  if(descriptor.kind==='inherited'){const parent=await this.resolve(descriptor.parentTable,row[descriptor.parentColumn],visited);return{row,scope:parent.scope};}
  const owner=row[descriptor.ownerColumn];if(typeof owner!=='string'||!owner)fail(403,'Resource ownership is unresolved');
  return{row,scope:{kind:'personal',owner_user_id:owner}};
 }
 async require(context,action,table,id){
  if(!context?.actorId)fail(401,'Authentication required');if(!actions.has(action))fail(403,'Unknown resource action');
  const resource=await this.resolve(table,id);const {scope}=resource;
  if(scope.kind==='personal'){if(scope.owner_user_id!==context.actorId)fail(404,'Resource not found');return resource;}
  if(!['team','workspace'].includes(scope.kind)||!scope.team_id||!this.authorizeTeam)fail(403,'Resource scope is unavailable');
  // The callback must verify current cloud membership AND workspace access, not a cached role.
  await this.authorizeTeam(context,action,scope);return resource;
 }
}
