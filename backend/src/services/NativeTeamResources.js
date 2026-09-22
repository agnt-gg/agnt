import {createHash,randomUUID} from 'node:crypto';
const TYPES={agent:'agents',workflow:'workflows',tool:'tools'};
const ownerColumn=kind=>kind==='workflow'?'user_id':'created_by';
const refuse=(status,message)=>{throw Object.assign(new Error(message),{status});};
const hashOf=content=>createHash('sha256').update(content).digest('hex');
/** The executable definition of a native row. One function, so a snapshot and a status check can never disagree. */
export function definitionOf(kind,row){
 if(kind==='workflow')return JSON.parse(row.workflow_data);
 if(kind==='agent')return{name:row.name,systemPrompt:row.system_prompt,assignedTools:JSON.parse(row.tools||'[]'),assignedWorkflows:JSON.parse(row.workflows||'[]'),assignedSkills:JSON.parse(row.skills||'[]')};
 const config=JSON.parse(row.config||'{}');
 return{name:row.title,base:row.base,code:row.code,config,instructions:config.instructions};
}
/**
 * Which provider and model an item was built for, read from the live row. Kept OUT of
 * definitionOf on purpose: adding fields there would change every existing snapshot's
 * hash and silently un-publish everything already approved.
 */
export function modelHintsOf(kind,row){
 if(kind==='agent')return{provider:row.provider||null,model:row.model||null};
 if(kind==='tool'){const config=JSON.parse(row.config||'{}');return{provider:config.provider||null,model:config.model||null};}
 const node=(JSON.parse(row.workflow_data||'{}').nodes||[]).find(n=>n?.parameters?.provider);
 return{provider:node?.parameters?.provider||null,model:node?.parameters?.model||null};
}
/**
 * Draft / published, per item:
 *   draft      never published
 *   published  the published version is what is in the project now
 *   changed    edited since publishing; the PUBLISHED version is still the one that runs
 */
export function publicationStatus(currentHash,mapping,binding,asset){
 if(!binding||!mapping)return'draft';
 return mapping.content_hash===currentHash&&binding.approved_revision===asset?.revision?'published':'changed';
}
/** Native rows are authoritative; approved snapshots only pin the revision being executed. */
export class NativeTeamResources{
 constructor(native,teams){this.native=native;this.teams=teams;}
 async initialize(){await this.teams.run('CREATE TABLE IF NOT EXISTS team_native_resources(scope_id TEXT NOT NULL,kind TEXT NOT NULL,resource_id TEXT NOT NULL,asset_id TEXT NOT NULL REFERENCES team_assets(id),content_hash TEXT NOT NULL,PRIMARY KEY(scope_id,kind,resource_id))');}
 async list(scope){
  await this.initialize();
  const result=[];
  for(const [kind,table]of Object.entries(TYPES)){
   const rows=await this.native.all(`SELECT * FROM ${table} WHERE ${ownerColumn(kind)}=?`,[scope.resourceOwnerId]);
   for(const row of rows){
    let status='draft',publishedRevision=null;
    try{
     const mapping=await this.teams.get('SELECT * FROM team_native_resources WHERE scope_id=? AND kind=? AND resource_id=?',[scope.id,kind,row.id]);
     if(mapping){
      const binding=await this.teams.get('SELECT approved_revision FROM team_native_bindings WHERE asset_id=?',[mapping.asset_id]).catch(error=>{if(/no such table/.test(error.message))return null;throw error;});
      const asset=await this.teams.get('SELECT revision FROM team_assets WHERE id=?',[mapping.asset_id]);
      status=publicationStatus(hashOf(JSON.stringify(definitionOf(kind,row))),mapping,binding,asset);
      publishedRevision=binding?.approved_revision??null;
     }
    }catch(error){if(!(error instanceof SyntaxError))throw error;}
    result.push({id:row.id,name:row.name||row.title,kind,scopeId:scope.id,status,publishedRevision});
   }
  }
  return result;
 }
 async hints(scope,kind,id){const table=TYPES[kind];if(!table)refuse(400,'Unsupported executable resource');const row=await this.native.get(`SELECT * FROM ${table} WHERE id=? AND ${ownerColumn(kind)}=?`,[id,scope.resourceOwnerId]);if(!row)refuse(404,'Resource not found');return modelHintsOf(kind,row);}
 async snapshot(teamId,actor,scope,kind,id){const table=TYPES[kind];if(!table)refuse(400,'Unsupported executable resource');const row=await this.native.get(`SELECT * FROM ${table} WHERE id=? AND ${ownerColumn(kind)}=?`,[id,scope.resourceOwnerId]);if(!row)refuse(404,'Resource not found');
 const content=JSON.stringify(definitionOf(kind,row)),hash=hashOf(content);
 return this.teams.transaction(async()=>{const mapping=await this.teams.get('SELECT * FROM team_native_resources WHERE scope_id=? AND kind=? AND resource_id=?',[scope.id,kind,id]);let assetId=mapping?.asset_id||randomUUID();
 if(mapping?.content_hash===hash)return assetId;
 const asset=await this.teams.get('SELECT revision FROM team_assets WHERE id=?',[assetId]);const revision=(asset?.revision||0)+1;const timestamp=new Date().toISOString();
 await this.teams.run('INSERT INTO team_assets VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at',[assetId,teamId,row.name||row.title||kind,kind,revision,actor,timestamp]);await this.teams.run('INSERT INTO team_asset_versions VALUES(?,?,?,?,?)',[assetId,revision,content,actor,timestamp]);await this.teams.run('INSERT INTO team_native_resources VALUES(?,?,?,?,?) ON CONFLICT(scope_id,kind,resource_id) DO UPDATE SET content_hash=excluded.content_hash',[scope.id,kind,id,assetId,hash]);return assetId;});
 }
}
