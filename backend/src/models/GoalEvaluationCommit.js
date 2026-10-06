import db from './database/index.js';
import { withTransaction } from './database/connectionGate.js';
import generateUUID from '../utils/generateUUID.js';

export const staleEvaluation = () => Object.assign(new Error('Goal or task evidence changed while grading; result was not committed.'), {code:'STALE_GOAL_EVALUATION',retryable:false});

/** One short transaction on the shared connection. The connection gate holds
 * every other statement on it until COMMIT, so unrelated writes can neither
 * join nor interleave with this transaction. (This used to open a second
 * connection for that isolation; a second connection holding the write lock
 * while the shared one's waiters pinned the thread pool is what deadlocked
 * the database — see connectionGate.js.) No LLM/network work occurs while the
 * lock is held. Goal revision includes all task row mutations.
 */
export async function commitGoalEvaluation({goal,userId,evaluationType,scores,passed,evaluationData,feedback,tokenUsage,taskEvaluations,assertCurrent}) {
  if (!Number.isSafeInteger(goal.lifecycle_revision)) throw staleEvaluation();
  const run = (sql,args=[])=>new Promise((resolve,reject)=>db.run(sql,args,function(error){error?reject(error):resolve(this.changes);}));
  const get = (sql,args=[])=>new Promise((resolve,reject)=>db.get(sql,args,(error,row)=>error?reject(error):resolve(row)));
  try {
    return await withTransaction(db, async () => {
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
      return {evaluationId,status};
    }, { label: 'goal evaluation commit' });
  } catch(error) {
    if(error?.transactionPhase==='commit')throw Object.assign(new Error('Evaluation commit outcome unknown; reconcile before retrying.'),{code:'EVALUATION_COMMIT_UNKNOWN',retryable:false});
    throw error;
  }
}
