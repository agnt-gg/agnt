import {randomUUID} from 'node:crypto';
const refuse=(status,message)=>{throw Object.assign(new Error(message),{status});};
export async function initializeExecutionAuthority(repository){
 await repository.run(`CREATE TABLE IF NOT EXISTS execution_principals(id TEXT PRIMARY KEY,scope_id TEXT NOT NULL REFERENCES ownership_scopes(id),name TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','revoked')),created_by TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
 await repository.run(`CREATE TABLE IF NOT EXISTS scoped_connections(id TEXT PRIMARY KEY,scope_id TEXT NOT NULL REFERENCES ownership_scopes(id),provider_id TEXT NOT NULL,remote_connection_id TEXT NOT NULL,created_by TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('active','revoked')),UNIQUE(scope_id,remote_connection_id))`);
 await repository.run(`CREATE TABLE IF NOT EXISTS execution_connection_grants(principal_id TEXT NOT NULL REFERENCES execution_principals(id),connection_id TEXT NOT NULL REFERENCES scoped_connections(id),PRIMARY KEY(principal_id,connection_id))`);
}
/** Reference-only authority: no bearer tokens, API keys or OAuth secrets belong in these tables. */
export class ExecutionAuthority {
 constructor(repository,authorizeScope,broker){this.repository=repository;this.authorizeScope=authorizeScope;this.broker=broker;}
 async createPrincipal(context,scopeId,name){
  await this.authorizeScope(context,'manage_automation',scopeId);
  if(typeof name!=='string'||!name.trim()||name.length>100)refuse(400,'Invalid principal name');
  const id=randomUUID();await this.repository.run("INSERT INTO execution_principals(id,scope_id,name,status,created_by) VALUES(?,?,?,'active',?)",[id,scopeId,name.trim(),context.actorId]);
  return{id,scopeId,name:name.trim()};
 }
 async grantConnection(context,principalId,connectionId){
  const principal=await this.repository.get('SELECT * FROM execution_principals WHERE id=? AND status=\'active\'',[principalId]);
  const connection=await this.repository.get('SELECT * FROM scoped_connections WHERE id=? AND status=\'active\'',[connectionId]);
  if(!principal||!connection)refuse(404,'Principal or connection unavailable');
  await this.authorizeScope(context,'manage_automation',principal.scope_id);
  await this.authorizeScope(context,'manage_connections',connection.scope_id);
  if(principal.scope_id!==connection.scope_id)refuse(403,'Cross-scope connection grants are not enabled');
  await this.repository.run('INSERT OR IGNORE INTO execution_connection_grants(principal_id,connection_id) VALUES(?,?)',[principalId,connectionId]);
 }
 async execute(context,principalId,connectionId,operation){
  const binding=await this.repository.get(`SELECT p.scope_id,p.revision,c.provider_id,c.remote_connection_id FROM execution_principals p JOIN execution_connection_grants g ON g.principal_id=p.id JOIN scoped_connections c ON c.id=g.connection_id WHERE p.id=? AND c.id=? AND p.status='active' AND c.status='active'`,[principalId,connectionId]);
  if(!binding)refuse(403,'Execution connection is not authorized');
  await this.authorizeScope(context,'run',binding.scope_id);
  if(!this.broker)refuse(503,'Scoped execution broker is not configured');
  // Broker must revalidate the principal revision and enforce operation capabilities remotely.
  return this.broker.execute({actorId:context.actorId,principalId,principalRevision:binding.revision,scopeId:binding.scope_id,connectionId:binding.remote_connection_id,operation});
 }
 async revoke(context,principalId){
  const principal=await this.repository.get('SELECT * FROM execution_principals WHERE id=?',[principalId]);if(!principal)refuse(404,'Principal not found');
  await this.authorizeScope(context,'manage_automation',principal.scope_id);
  await this.repository.run("UPDATE execution_principals SET status='revoked',revision=revision+1 WHERE id=?",[principalId]);
 }
}
