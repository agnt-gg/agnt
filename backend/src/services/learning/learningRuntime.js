import { getLearningCoordinator } from './LearningCoordinator.js';
import { READ_ONLY_CAPABILITIES, toolOutcome } from './learningContract.js';

/** No policy lookup failure may add authority. Retry actions are read-only and bounded to one. */
export async function executeWithLearning({ userId, executionId, callId, capability, execute, coordinator, assertCurrent }) {
  if (!userId || !executionId || !callId || !READ_ONLY_CAPABILITIES.includes(capability)) return execute();
  let service, work, trial;
  try {
    service = coordinator || await getLearningCoordinator();
    work = await service.work(userId,'agent',executionId);
    trial = await service.policyFor(userId,capability);
  } catch (error) {
    console.error('[Learning] Policy unavailable; using original execution:',error.code||error.message);
    return execute();
  }
  const startedAt = service.clock();
  let result, thrown;
  try { result = await execute(); } catch (error) { thrown = error; }
  const first = toolOutcome(result,thrown);
  let outcome = first, attempts = 1;
  if (trial && first.outcome === 'failed' && first.errorKind === trial.candidate.when.error_kind) {
    // Persist exposure BEFORE dispatch: if bookkeeping fails, do not perform extra work.
    let exposureRecorded=false;
    try {
      await service.append(userId,work.id,{ eventKey:`attempt:${executionId}:${callId}:1`,type:'tool_attempt',capability,
        outcome:first.outcome,errorKind:first.errorKind,occurredAt:startedAt,payload:{attempts:1} });
      const exposure=await service.append(userId,work.id,{ eventKey:`exposure:${executionId}:${callId}`,type:'policy_exposure',capability,
        trialId:trial.id,outcome:first.outcome,errorKind:first.errorKind,occurredAt:startedAt,payload:{candidateHash:trial.candidate_hash} });
      exposureRecorded=exposure.inserted;
    }catch(error){console.error('[Learning] Retry not dispatched: exposure recording failed.',error.code||'recording_failed');}
    let current=null;
    try{current=await service.policyFor(userId,capability);}catch(error){console.error('[Learning] Retry not dispatched: policy recheck unavailable.');}
    if (exposureRecorded && current?.id === trial.id && current.candidate_hash === trial.candidate_hash) {
      await assertCurrent?.();
      attempts = 2;
      thrown = null;
      try { result = await execute(); } catch (error) { thrown = error; }
      outcome = toolOutcome(result,thrown);
    }
  }
  try {
    await service.append(userId,work.id,{eventKey:`call:${executionId}:${callId}`,type:'tool_outcome',capability,
      outcome:outcome.outcome,errorKind:outcome.errorKind,trialId:trial?.id||null,occurredAt:startedAt,
      payload:{durationMs:Math.max(0,service.clock()-startedAt),attempts,recovered:first.outcome==='failed'&&outcome.outcome==='succeeded'} });
  } catch (error) { console.error('[Learning] Outcome recording failed:',error.code||error.message); }
  if (thrown) throw thrown;
  return result;
}

/** Read existing rows; never store prompt bodies, arguments, outputs or raw error text here. */
export async function observeExecution(sourceType, sourceId, userId) {
  const {default:db,dbReady}=await import('../../models/database/index.js');await dbReady;
  const get=(sql,args)=>new Promise((resolve,reject)=>db.get(sql,args,(error,row)=>error?reject(error):resolve(row)));
  const all=(sql,args)=>new Promise((resolve,reject)=>db.all(sql,args,(error,rows)=>error?reject(error):resolve(rows)));
  const service=await getLearningCoordinator();
  const table=sourceType==='agent'?'agent_executions':sourceType==='workflow'?'workflow_executions':'goals';
  const source=await get(`SELECT * FROM ${table} WHERE id=? AND user_id=?`,[sourceId,userId]);
  if(!source)throw Object.assign(new Error('Execution unavailable'),{code:'not_found'});
  const work=await service.work(userId,sourceType,sourceId);
  const rows=sourceType==='agent'?await all('SELECT * FROM agent_tool_executions WHERE execution_id=? ORDER BY start_time LIMIT 1000',[sourceId]):
    sourceType==='workflow'?await all('SELECT * FROM node_executions WHERE execution_id=? ORDER BY start_time LIMIT 1000',[sourceId]):[];
  for(const row of rows){
    const capability=row.tool_name||`node:${row.node_id}`;
    const outcome=toolOutcome(row.output,row.error?{message:row.error}:null);
    const occurredAt=Date.parse(row.start_time)||service.clock();
    await service.append(userId,work.id,{eventKey:`call:${sourceId}:${row.tool_call_id||row.id}`,type:'tool_outcome',capability,
      outcome:outcome.outcome,errorKind:outcome.errorKind,occurredAt,payload:{attempts:1,durationMs:Math.max(0,(Date.parse(row.end_time)||occurredAt)-occurredAt)} });
  }
  const state=['validated','completed'].includes(source.status)?'completed':['paused','pending','needs_review'].includes(source.status)?'blocked':
    ['failed','error'].includes(source.status)?'failed':['cancelled','stopped'].includes(source.status)?'cancelled':source.status==='interrupted'?'interrupted':'running';
  await service.finishWork(userId,work.id,state);
  return {workId:work.id,observed:rows.length};
}

/** Bounded, restartable reconciliation for producers that run in other processes. */
export async function reconcileLearningEvidence(limit = 50) {
  const {default:db,dbReady}=await import('../../models/database/index.js');await dbReady;
  const service=await getLearningCoordinator();
  const all=(sql,args)=>new Promise((resolve,reject)=>db.all(sql,args,(error,rows)=>error?reject(error):resolve(rows)));
  for(const [type,table,timeField] of [['agent','agent_executions','end_time'],['workflow','workflow_executions','end_time'],['goal','goals','updated_at']]) {
    let cursor=await service.get('SELECT * FROM learning_cursors WHERE source_type=?',[type]);
    if(!cursor){
      await service.transaction(()=>service.run("INSERT OR IGNORE INTO learning_cursors(source_type,last_seen_at) VALUES(?,?)",[type,new Date(service.clock()).toISOString()]));
      continue;
    }
    const rows=await all(            `SELECT id,user_id,strftime('%Y-%m-%dT%H:%M:%fZ',${timeField}) AS observed_at FROM ${table}
        WHERE user_id IS NOT NULL AND ${timeField} IS NOT NULL AND status NOT IN ('running','executing','started','planning')
          AND (strftime('%Y-%m-%dT%H:%M:%fZ',${timeField})>? OR (strftime('%Y-%m-%dT%H:%M:%fZ',${timeField})=? AND id>?))
        ORDER BY observed_at,id LIMIT ?`,[cursor.last_seen_at,cursor.last_seen_at,cursor.last_id,limit]);
    for(const row of rows){
      await observeExecution(type,row.id,row.user_id);
      await service.transaction(()=>service.run('UPDATE learning_cursors SET last_seen_at=?,last_id=? WHERE source_type=?',[row.observed_at,row.id,type]));
    }
  }
}
