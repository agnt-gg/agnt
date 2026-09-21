import {createHash,randomBytes} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const deny=(status,message)=>{throw Object.assign(new Error(message),{status});};
/** Explicit snapshot approval, not a claim that arbitrary text contains no secrets.
 * The caller must first authorize the source and destination. No paths or credentials
 * are loaded here. A process restart invalidates approvals rather than reconstructing them.
 */
export class ApprovedPublication {
 constructor({clock=Date.now,maxBytes=1048576,maxPending=100,ttlMs=600000}={}){Object.assign(this,{clock,maxBytes,maxPending,ttlMs});this.pending=new Map();}
 prune(){const now=this.clock();for(const [key,entry] of this.pending)if(entry.expiresAt<=now)this.pending.delete(key);}
 preview({actorId,teamId,collectionId,kind,content}){
  if(!actorId||!teamId||!collectionId)deny(400,'Publication identity and destination required');
  if(!['agent','workflow','tool','skill','widget','document'].includes(kind)||typeof content!=='string')deny(400,'Invalid publication');
  const bytes=Buffer.from(content,'utf8');if(bytes.length>this.maxBytes)deny(413,'Publication too large');
  this.prune();if(this.pending.size>=this.maxPending)deny(429,'Too many pending approvals');
  const approvalId=randomBytes(32).toString('base64url'),sha256=digest(bytes),expiresAt=this.clock()+this.ttlMs;
  this.pending.set(approvalId,{actorId,teamId,collectionId,kind,bytes,sha256,expiresAt,state:'pending'});
  return{approvalId,teamId,collectionId,kind,content,sha256,byteLength:bytes.length,expiresAt};
 }
 async publish({approvalId,actorId,teamId,collectionId,sha256},authorizeDestination,upload){
  this.prune();const entry=this.pending.get(approvalId);
  if(!entry||entry.actorId!==actorId)deny(404,'Approval unavailable');
  if(entry.teamId!==teamId||entry.collectionId!==collectionId||entry.sha256!==sha256)deny(409,'Publication differs from approved snapshot');
  if(entry.state!=='pending')deny(409,'Publication already started');
  entry.state='publishing';
  try{
   await authorizeDestination({actorId,teamId,collectionId});
   if(entry.expiresAt<=this.clock())deny(410,'Approval expired');
   // Remote commit must deduplicate this key: a lost response must not duplicate versions.
   const result=await upload({teamId,collectionId,kind:entry.kind,bytes:Buffer.from(entry.bytes),sha256:entry.sha256,idempotencyKey:approvalId});
   this.pending.delete(approvalId);return result;
  }catch(error){entry.state='pending';throw error;}
 }
}
