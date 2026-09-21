import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const deny=(status,message)=>{throw Object.assign(new Error(message),{status});};
/** Cloud-only file adapter. Root must be a private service-owned directory, not
 * an arbitrary desktop folder. Authorization is checked for every operation.
 */
export class WorkspaceFileService{
 constructor({root,authorize,maxBytes=10485760}){if(!path.isAbsolute(root))throw new TypeError('Absolute root required');Object.assign(this,{root,authorize,maxBytes});}
 async resolve(context,relative,{createRoot=false}={}){
  if(!context.teamId||!context.tenantSlug||!context.workspaceId)deny(400,'Workspace context required');
  if(typeof relative!=='string'||relative.includes('\0')||relative.includes('\\')||relative.includes(':')||path.posix.isAbsolute(relative)||relative.split('/').some(part=>part==='..'||part==='.'||part===''))deny(400,'Invalid workspace path');
  const key=createHash('sha256').update(JSON.stringify([context.teamId,context.tenantSlug,context.workspaceId])).digest('hex');const root=path.join(this.root,key);
  if(createRoot)await fs.mkdir(root,{recursive:true,mode:0o700});
  const base=await fs.lstat(root);if(base.isSymbolicLink()||!base.isDirectory())deny(403,'Invalid workspace root');
  const parts=relative.split('/');let current=root;
  for(let index=0;index<parts.length;index++){current=path.join(current,parts[index]);try{const entry=await fs.lstat(current);if(entry.isSymbolicLink())deny(403,'Links are not permitted');if(index<parts.length-1&&!entry.isDirectory())deny(400,'Invalid parent directory');}catch(error){if(error.code!=='ENOENT'||index<parts.length-1)throw error;}}
  return current;
 }
 async read(context,relative){await this.authorize(context,'files.read');const target=await this.resolve(context,relative);const stat=await fs.stat(target);if(!stat.isFile()||stat.size>this.maxBytes)deny(413,'File exceeds read limit');return fs.readFile(target);}
 async write(context,relative,bytes){await this.authorize(context,'files.write');if(!Buffer.isBuffer(bytes)||bytes.length>this.maxBytes)deny(413,'File exceeds write limit');const target=await this.resolve(context,relative,{createRoot:true});const temporary=target+'.upload-'+randomUUID();try{await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o600});await this.authorize(context,'files.write');await fs.rename(temporary,target);}catch(error){try{await fs.unlink(temporary);}catch(cleanup){if(cleanup.code!=='ENOENT')throw new AggregateError([error,cleanup],'Write cleanup failed');}throw error;}return{bytes:bytes.length};}
}
