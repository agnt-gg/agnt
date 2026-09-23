import sqlite3 from 'sqlite3';
import db from './database/index.js';
import generateUUID from '../utils/generateUUID.js';

export const staleEvaluation = () => Object.assign(new Error('Goal or task evidence changed while grading; result was not committed.'), {code:'STALE_GOAL_EVALUATION',retryable:false});

/** Dedicated short transaction: unrelated writes on the application's shared
 * sqlite handle cannot accidentally join this transaction. No LLM/network work
 * occurs while holding the lock. Goal revision includes all task row mutations.
 */
export async function commitGoalEvaluation({goal,userId,evaluationType,scores,passed,evaluationData,feedback,tokenUsage,taskEvaluations,assertCurrent}) {
  if (!Number.isSafeInteger(goal.lifecycle_revision)) throw staleEvaluation();
  const connection = await new Promise((resolve,reject)=>{
    const c = new sqlite3.Database(db.filename,sqlite3.OPEN_READWRITE,error=>error?reject(error):resolve(c));
  });
  connection.configure('busyTimeout',2000);
  const run = (sql,args=[])=>new Promise((resolve,reject)=>connection.run(sql,args,function(error){error?reject(error):resolve(this.changes);}));
  const get = (sql,args=[])=>new Promise((resolve,reject)=>connection.get(sql,args,(error,row)=>error?reject(error):resolve(row)));
  let transaction = false, commitAttempted = false;
  try {
    await run('PRAGMA foreign_keys=ON');
    await run('BEGIN IMMEDIATE'); transaction=true;
    assertCurrent?.();
    const current=await get("SELECT g.*,COALESCE(v.revision,0) AS lifecycle_revision FROM goals g LEFT JOIN goal_lifecycle_versions v ON v.kind='goal' AND v.entity_id=g.id WHERE g.id=? AND g.user_id=?",[goal.id,userId]);
    if (!current || current.deleted_at || ['paused','stopped'].includes(current.status) || current.lifecycle_revision!==goal.lifecycle_revision) throw staleEvaluation();
    const evaluationId=generateUUID();
    await run(`INSERT INTO goal_evaluations(id,goal_id,evaluation_type,overall_score,passed,evaluation_data,feedback,evaluated_by,input_tokens,output_tokens,total_tokens,estimated_cost) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      [evaluationId,goal.id,evaluationType,scores.overall,passed?1:0,JSON.stringify(evaluationData),feedback,'system',tokenUsage?.inputTokens||0,tokenUsage?.outputTokens||0,tokenUsage?.totalTokens||0,tokenUsage?.estimatedCost||0]);
    for(const t of taskEvaluations) await run('INSERT INTO task_evaluations(id,task_id,goal_evaluation_id,criteria_met,score,feedback) VALUES(?,?,?,?,?,?)',
      [generateUUID(),t.taskId,evaluationId,JSON.stringify(t.criteriaMet),t.score,t.feedback]);
    const status=passed?'validated':'needs_review';
    const changed=await run(`UPDATE goals SET status=?,updated_at=?,completed_at=? WHERE id=? AND user_id=? AND COALESCE((SELECT revision FROM goal_lifecycle_versions WHERE kind='goal' AND entity_id=goals.id),0)=?`,
      [status,new Date().toISOString(),passed?new Date().toISOString():null,goal.id,userId,goal.lifecycle_revision]);
    if(changed!==1)throw staleEvaluation();
    assertCurrent?.();
    commitAttempted=true;
    await run('COMMIT');transaction=false;
    return {evaluationId,status};
  } catch(error) {
    if(transaction)await run('ROLLBACK').catch(()=>{});
    if(commitAttempted)throw Object.assign(new Error('Evaluation commit outcome unknown; reconcile before retrying.'),{code:'EVALUATION_COMMIT_UNKNOWN',retryable:false});
    throw error;
  } finally {await new Promise(resolve=>connection.close(()=>resolve()));}
}
