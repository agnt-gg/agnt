import {createHash} from 'node:crypto';
export const scopeOwnerId=scopeId=>'scope:'+createHash('sha256').update(scopeId).digest('hex');
export function databaseRepository(db){return {
 run:(sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(error){error?reject(error):resolve({changes:this.changes})})),
 get:(sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(error,row)=>error?reject(error):resolve(row))),
 all:(sql,args=[])=>new Promise((resolve,reject)=>db.all(sql,args,(error,rows)=>error?reject(error):resolve(rows)))
};}
export async function ensureSharedScope(repository,teamId,workspaceId=null){
 const id=workspaceId?'workspace:'+workspaceId:'team:'+teamId;
 const owner=scopeOwnerId(id);
 await repository.run('INSERT OR IGNORE INTO users(id,name) VALUES(?,?)',[owner,'Team resource owner']);
 await repository.run('INSERT OR IGNORE INTO ownership_scopes(id,kind,team_id) VALUES(?,?,?)',[id,workspaceId?'workspace':'team',teamId]);
 const scope=await repository.get('SELECT * FROM ownership_scopes WHERE id=?',[id]);
 if(scope.team_id!==teamId)throw Object.assign(new Error('Scope belongs to another team'),{status:403});
 await repository.run('INSERT OR IGNORE INTO scope_resource_owners(scope_id,user_id) VALUES(?,?)',[id,owner]);
 return {...scope,resourceOwnerId:owner};
}
