import {createHash,randomUUID} from 'node:crypto';
const TYPES={agent:'agents',workflow:'workflows',tool:'tools'};
const ownerColumn=kind=>kind==='workflow'?'user_id':'created_by';
const refuse=(status,message)=>{throw Object.assign(new Error(message),{status});};
/** Native rows are authoritative; approved snapshots only pin the revision being executed. */
export class NativeTeamResources{
 constructor(native,teams){this.native=native;this.teams=teams;}
 async initialize(){await this.teams.run('CREATE TABLE IF NOT EXISTS team_native_resources(scope_id TEXT NOT NULL,kind TEXT NOT NULL,resource_id TEXT NOT NULL,asset_id TEXT NOT NULL REFERENCES team_assets(id),content_hash TEXT NOT NULL,PRIMARY KEY(scope_id,kind,resource_id))');}
 async list(scope){const result=[];for(const [kind,table]of Object.entries(TYPES)){const rows=await this.native.all(`SELECT * FROM ${table} WHERE ${ownerColumn(kind)}=?`,[scope.resourceOwnerId]);for(const row of rows)result.push({id:row.id,name:row.name||row.title,kind,scopeId:scope.id});}return result;}
 async snapshot(teamId,actor,scope,kind,id){const table=TYPES[kind];if(!table)refuse(400,'Unsupported executable resource');const row=await this.native.get(`SELECT * FROM ${table} WHERE id=? AND ${ownerColumn(kind)}=?`,[id,scope.resourceOwnerId]);if(!row)refuse(404,'Resource not found');
 let definition;if(kind==='workflow')definition=JSON.parse(row.workflow_data);else if(kind==='agent')definition={name:row.name,systemPrompt:row.system_prompt,assignedTools:JSON.parse(row.tools||'[]'),assignedWorkflows:JSON.parse(row.workflows||'[]')};else definition={name:row.title,base:row.base,code:row.code,config:JSON.parse(row.config||'{}'),instructions:JSON.parse(row.config||'{}').instructions};
 const content=JSON.stringify(definition),hash=createHash('sha256').update(content).digest('hex');
 return this.teams.transaction(async()=>{const mapping=await this.teams.get('SELECT * FROM team_native_resources WHERE scope_id=? AND kind=? AND resource_id=?',[scope.id,kind,id]);let assetId=mapping?.asset_id||randomUUID();
 if(mapping?.content_hash===hash)return assetId;
 const asset=await this.teams.get('SELECT revision FROM team_assets WHERE id=?',[assetId]);const revision=(asset?.revision||0)+1;const timestamp=new Date().toISOString();
 await this.teams.run('INSERT INTO team_assets VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at',[assetId,teamId,row.name||row.title||kind,kind,revision,actor,timestamp]);await this.teams.run('INSERT INTO team_asset_versions VALUES(?,?,?,?,?)',[assetId,revision,content,actor,timestamp]);await this.teams.run('INSERT INTO team_native_resources VALUES(?,?,?,?,?) ON CONFLICT(scope_id,kind,resource_id) DO UPDATE SET content_hash=excluded.content_hash',[scope.id,kind,id,assetId,hash]);return assetId;});
 }
}
