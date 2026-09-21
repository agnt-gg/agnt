import { createHash } from 'node:crypto';
import asyncQueue from '../AsyncToolQueue.js';
import { recoverConversationWork } from './recoverConversationWork.js';
import { createConversationWorkApplication } from './conversationWorkApplication.js';
import { createWorkStreamHub } from './workStreamHub.js';
import { installConversationWorkRuntime } from './conversationWorkRegistry.js';
import { verifyViaIssuer } from '../auth/remoteTokenVerifier.js';
import { isPermittedUser } from '../auth/tenantOwnership.js';
import { currentTeamExecution } from '../authorization/TeamExecutionContext.js';
import { currentScopeRequest } from '../authorization/ScopeRequestContext.js';
import { reviewWorkSemantics } from './semanticWorkReview.js';

/** Boot wiring: persist first, resume through the existing execution engine. */
export async function bootConversationWork({ database, executeSegment, review = reviewWorkSemantics, enableScheduling = false, verificationPolicy, onError = console.error }) {
  if (enableScheduling && typeof verificationPolicy !== 'function') {
    throw new Error('Production completion verification is required before enabling automatic work');
  }
  let application;
  let hub;
  const transports={attach:(...args)=>hub.attach(...args),forWork:(...args)=>hub.forWork(...args)};
  application=await createConversationWorkApplication({database,executeSegment,transports,asyncQueue,onError,
    authorize:async input=>{
      if(!input.userId)throw new Error('Authenticated owner required');
      const existing=await application.store.get('SELECT owner_id FROM conversation_work WHERE conversation_id=? LIMIT 1',[input.conversationId]);
      if(existing && existing.owner_id!==input.userId)throw new Error('Conversation ownership mismatch');
    },
    authorityOptions:{
      capture:async input=>{
        const team=currentTeamExecution();const scope=currentScopeRequest();
        if(team || scope)throw Object.assign(new Error('Scoped background execution requires a renewable execution binding'),{code:'waiting_permission'});
        return {kind:'personal',binding:{ownerId:input.userId},credential:input.authToken};
      },
      verifyCredential:async credential=>{
        const result=await verifyViaIssuer(credential.replace(/^Bearer\s+/i,''));
        const ownerId=result.user?.id||result.user?.userId;
        return {ok:result.ok && isPermittedUser(ownerId,result.tenant,result.user?.email),ownerId};
      },
      authorizeScope:async(work,binding)=>{
        if(binding.ownerId!==work.owner_id)throw Object.assign(new Error('Work owner changed'),{code:'waiting_permission'});
      },
      resolveTeam:async()=>{throw Object.assign(new Error('Team grant resolution required'),{code:'waiting_permission'});},
    },
    contracts:{
      create:async({work,snapshots})=>snapshots.forWork(work).write({objective:work.objective,revision:work.revision,sourceHash:createHash('sha256').update(work.objective).digest('hex')}),
      verify:async({work,checkpoint,signal,snapshots})=>{
        const storage=snapshots.forWork(work);
        const contract=await storage.read(checkpoint.contractRef);
        if(contract.objective!==work.objective || contract.revision!==work.revision)throw new Error('Contract revision mismatch');
        const history=await storage.read(checkpoint.historyRef);
        const authority=await application.authority.resolve(work);
        const verdict=await review({work,history,authority,signal});
        const reference=await storage.write(verdict);
        checkpoint.validationRef=reference;
        checkpoint.continuation=verdict.complete?undefined:`The original request is not complete. Continue the work and verify it. Outstanding requirements:\n${verdict.unmet.join('\n')}`;
        const operations=await new Promise((resolve,reject)=>database.all('SELECT status FROM conversation_operations WHERE work_id=?',[work.id],(error,rows)=>error?reject(error):resolve(rows)));
        if (verificationPolicy) return verificationPolicy({work,checkpoint,history,verdict,reference,operations,signal});
        // Semantic review can find missing work, but cannot certify completion.
        return {requirements:[{id:'original-request',kind:'judgment',targetVersion:verdict.targetVersion}],operations};
      },
    },
  });
  await recoverConversationWork(application.store);
  hub=createWorkStreamHub({store:application.store,onError});
  application.close=async()=>{application.stopAdmissions();await application.scheduler.drain();await hub.close();};
  // The installed policy declares its evidence type explicitly. MVP semantic
  // acceptance is judgment; stronger task-specific validators can replace it.
  if (enableScheduling) {
    installConversationWorkRuntime(application);
    application.start();
  }
  return application;
}
