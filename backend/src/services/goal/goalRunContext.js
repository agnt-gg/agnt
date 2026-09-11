import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
export const withGoalRun=(lease,fn)=>context.run(lease,fn);
export const currentGoalRun=()=>context.getStore()||null;
// Bindings are appended to UPDATEs, never interpolated from worker input.
export function goalRunGuard(goalExpression,params) {
  const l=currentGoalRun();if(!l)return '';
  params.push(l.goalId,l.runId,l.generation,l.userId);
  return ` AND ${goalExpression}=? AND EXISTS(SELECT 1 FROM goal_run_ownership ro JOIN goals rg ON rg.id=ro.goal_id
    WHERE ro.goal_id=${goalExpression} AND ro.run_id=? AND ro.generation=? AND ro.user_id=? AND ro.state='running'
    AND ro.lease_until > CAST(strftime('%s','now') AS INTEGER)*1000
    AND rg.deleted_at IS NULL AND rg.status NOT IN ('paused','stopped'))`;
}
