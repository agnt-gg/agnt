// Dependency-injected SQLite store: importing this module never opens production data.
import {randomUUID} from 'node:crypto';
export class GoalRunOwnership {
  constructor(db) { this.db=db; this.queue=Promise.resolve(); }
  run(sql,p=[]) { return new Promise((resolve,reject)=>this.db.run(sql,p,function(e){e?reject(e):resolve(this.changes)})); }
  get(sql,p=[]) { return new Promise((resolve,reject)=>this.db.get(sql,p,(e,r)=>e?reject(e):resolve(r))); }
  all(sql,p=[]) { return new Promise((resolve,reject)=>this.db.all(sql,p,(e,r)=>e?reject(e):resolve(r))); }
  transaction(fn) {
    const work=this.queue.catch(()=>{}).then(async()=>{await this.run('BEGIN IMMEDIATE');try{const result=await fn();await this.run('COMMIT');return result}catch(e){await this.run('ROLLBACK').catch(()=>{});throw e}});
    this.queue=work;return work;
  }
  async initialize() {
    await this.run(`CREATE TABLE IF NOT EXISTS goal_run_ownership (
      goal_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,run_id TEXT NOT NULL,
      boot_id TEXT NOT NULL,generation INTEGER NOT NULL,lease_until INTEGER NOT NULL,
      state TEXT NOT NULL,reason TEXT,checkpoint TEXT NOT NULL DEFAULT '{}'
    )`);
    await this.run(`CREATE TABLE IF NOT EXISTS goal_run_attempts(goal_id TEXT NOT NULL,run_id TEXT NOT NULL,generation INTEGER NOT NULL,task_id TEXT NOT NULL,state TEXT NOT NULL,attempt_id TEXT NOT NULL,task_revision INTEGER NOT NULL,PRIMARY KEY(goal_id,run_id,task_id))`);
    await this.run('CREATE TABLE IF NOT EXISTS goal_recovery_task_versions(task_id TEXT PRIMARY KEY,revision INTEGER NOT NULL)');
    for(const event of ['INSERT','UPDATE','DELETE']) {
      const row=event==='DELETE'?'OLD':'NEW';
      await this.run(`CREATE TRIGGER IF NOT EXISTS goal_recovery_task_${event.toLowerCase()} AFTER ${event==='UPDATE'?'UPDATE OF status, output, goal_id':event} ON tasks BEGIN
        INSERT INTO goal_recovery_task_versions VALUES(${row}.id,1) ON CONFLICT(task_id) DO UPDATE SET revision=revision+1;
      END`);
    }
    await this.run(`CREATE TABLE IF NOT EXISTS goal_run_resolutions(id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,run_id TEXT NOT NULL,user_id TEXT NOT NULL,recorded_at INTEGER NOT NULL,evidence TEXT NOT NULL,decisions TEXT NOT NULL)`);
  }
  async beginAttempt(l,taskId,now=Date.now()) {
    const attemptId=randomUUID();
    const changed=await this.run(`INSERT INTO goal_run_attempts(goal_id,run_id,generation,task_id,state,attempt_id,task_revision)
      SELECT ?,?,?,?,'admitted',?,COALESCE((SELECT revision FROM goal_recovery_task_versions WHERE task_id=?),0)
      WHERE EXISTS(SELECT 1 FROM goal_run_ownership o JOIN goals g ON g.id=o.goal_id
        WHERE o.goal_id=? AND o.run_id=? AND o.generation=? AND o.state='running' AND o.lease_until>?
        AND g.deleted_at IS NULL AND g.status NOT IN ('paused','stopped'))
      AND EXISTS(SELECT 1 FROM tasks WHERE id=? AND goal_id=? AND status!='completed')
      ON CONFLICT(goal_id,run_id,task_id) DO UPDATE SET state='admitted',attempt_id=excluded.attempt_id,task_revision=excluded.task_revision
      WHERE goal_run_attempts.state!='admitted'`,[l.goalId,l.runId,l.generation,taskId,attemptId,taskId,l.goalId,l.runId,l.generation,now,taskId,l.goalId]);
    return changed===1?attemptId:false;
  }
  commitAttempt(l,taskId,output,now=Date.now()) {
    return this.transaction(async()=>{
      const permitted=await this.get(`SELECT 1 FROM goal_run_ownership o JOIN goals g ON g.id=o.goal_id
        JOIN goal_run_attempts a ON a.goal_id=o.goal_id AND a.run_id=o.run_id AND a.generation=o.generation
        WHERE o.goal_id=? AND o.run_id=? AND o.generation=? AND o.state='running' AND o.lease_until>?
        AND g.deleted_at IS NULL AND g.status NOT IN ('paused','stopped') AND a.task_id=? AND a.state='admitted'
        AND a.attempt_id=? AND a.task_revision=COALESCE((SELECT revision FROM goal_recovery_task_versions WHERE task_id=a.task_id),0)`,[l.goalId,l.runId,l.generation,now,taskId,l.attemptId]);
      if(!permitted)return false;
      const changed=await this.run("UPDATE tasks SET status='completed',output=?,progress=100,completed_at=?,updated_at=? WHERE id=? AND goal_id=?",[JSON.stringify(output),new Date(now).toISOString(),new Date(now).toISOString(),taskId,l.goalId]);
      if(changed!==1)throw Error('Task disappeared during result commit');
      await this.run("UPDATE goal_run_attempts SET state='committed' WHERE goal_id=? AND run_id=? AND task_id=?",[l.goalId,l.runId,taskId]);
      return true;
    });
  }
  resolve(goalId,userId,runId,{decisions,evidence}={},now=Date.now()) {
    return this.transaction(async()=>{
      const g=await this.get('SELECT * FROM goals WHERE id=?',[goalId]);
      const o=await this.inspect(goalId);
      if(!g||g.deleted_at||g.user_id!==userId||!o||o.run_id!==runId||o.state!=='interrupted')throw Error('Interrupted run owner or generation mismatch');
      if(typeof evidence!=='string'||evidence.trim().length<3||!Array.isArray(decisions)||decisions.length>1000)throw Error('Resolution evidence and decisions required');
      const unresolved=await this.all("SELECT task_id FROM goal_run_attempts WHERE goal_id=? AND state='admitted'",[goalId]);
      const legacy=await this.all("SELECT id FROM tasks WHERE goal_id=? AND status IN ('running','assigned')",[goalId]);
      const required=new Set([...unresolved.map(a=>a.task_id),...legacy.map(t=>t.id)]);
      if(decisions.length!==required.size||new Set(decisions.map(d=>d?.taskId)).size!==required.size)throw Error('Resolution must cover each uncertain task exactly once');
      for(const d of decisions){
        if(!required.has(d.taskId)||typeof d.evidence!=='string'||d.evidence.trim().length<3||!['not_executed','completed'].includes(d.outcome))throw Error('Invalid task resolution evidence');
        if(d.outcome==='completed'&&(!d.output||typeof d.output!=='object'))throw Error('Verified output required');
        if(d.outcome==='not_executed')await this.run("UPDATE tasks SET status='pending',error=NULL WHERE id=? AND goal_id=?",[d.taskId,goalId]);
        else await this.run("UPDATE tasks SET status='completed',output=?,progress=100,completed_at=?,updated_at=? WHERE id=? AND goal_id=?",[JSON.stringify(d.output),new Date(now).toISOString(),new Date(now).toISOString(),d.taskId,goalId]);
        await this.run("UPDATE goal_run_attempts SET state=? WHERE goal_id=? AND task_id=? AND state='admitted'",['resolved_'+d.outcome,goalId,d.taskId]);
      }
      await this.run('INSERT INTO goal_run_resolutions VALUES(?,?,?,?,?,?,?)',[randomUUID(),goalId,runId,userId,now,evidence,JSON.stringify(decisions)]);
      await this.run("UPDATE goal_run_ownership SET state='released',reason='outcome_reconciled' WHERE goal_id=? AND run_id=?",[goalId,runId]);
      // Resolving evidence does not start execution or override a pause/stop.
      return {resolved:true,started:false};
    });
  }
  inspect(goalId) { return this.get('SELECT * FROM goal_run_ownership WHERE goal_id=?',[goalId]); }
  acquire(goalId,userId,bootId,now=Date.now()) {
    return this.transaction(async()=>{
      const goal=await this.get('SELECT * FROM goals WHERE id=?',[goalId]);
      if(!goal||goal.user_id!==userId||goal.deleted_at)throw Error('Goal owner access denied');
      const old=await this.inspect(goalId);
      if(old?.state==='running'&&old.lease_until>now)throw Error('Goal already owned by a live run');
      if(await this.get("SELECT 1 FROM goal_run_attempts WHERE goal_id=? AND state='admitted' LIMIT 1",[goalId]))throw Error('Task outcome unknown: unresolved admitted attempt');
      if(old?.state==='interrupted'||(old?.state==='running'&&old.lease_until<=now))throw Error('Interrupted goal: external outcome requires reconciliation');
      if(await this.get("SELECT id FROM tasks WHERE goal_id=? AND status IN ('running','assigned') LIMIT 1",[goalId]))throw Error('Task outcome unknown: reconcile before execution');
      const lease={goalId,userId,runId:randomUUID(),bootId,generation:(old?.generation||0)+1};
      await this.run(`INSERT INTO goal_run_ownership(goal_id,user_id,run_id,boot_id,generation,lease_until,state,reason,checkpoint)
        VALUES(?,?,?,?,?,?,'running',NULL,'{}') ON CONFLICT(goal_id) DO UPDATE SET
        user_id=excluded.user_id,run_id=excluded.run_id,boot_id=excluded.boot_id,generation=excluded.generation,
        lease_until=excluded.lease_until,state='running',reason=NULL,checkpoint='{}'`,
        [goalId,userId,lease.runId,bootId,lease.generation,now+30000]);return lease;
    });
  }
  renew(l,now=Date.now()) {return this.run("UPDATE goal_run_ownership SET lease_until=? WHERE goal_id=? AND run_id=? AND generation=? AND state='running' AND lease_until>?",[now+30000,l.goalId,l.runId,l.generation,now]).then(n=>n===1);}
  release(l) {return this.run("UPDATE goal_run_ownership SET state=CASE WHEN ((json_extract(checkpoint,'$.phase')='external_work_admitted' OR EXISTS(SELECT 1 FROM goal_run_attempts a WHERE a.goal_id=goal_run_ownership.goal_id AND a.state='admitted')) OR EXISTS(SELECT 1 FROM goal_run_attempts a WHERE a.goal_id=goal_run_ownership.goal_id AND a.state='admitted')) THEN 'interrupted' ELSE 'released' END,reason=CASE WHEN json_extract(checkpoint,'$.phase')='external_work_admitted' THEN 'external_outcome_unknown' ELSE NULL END,lease_until=0 WHERE goal_id=? AND run_id=? AND generation=? AND state='running'",[l.goalId,l.runId,l.generation]).then(n=>n===1);}
  checkpoint(l,value,now=Date.now()) {return this.run("UPDATE goal_run_ownership SET checkpoint=? WHERE goal_id=? AND run_id=? AND generation=? AND state='running' AND lease_until>?",[JSON.stringify(value),l.goalId,l.runId,l.generation,now]).then(n=>n===1);}
  reconcile(now=Date.now()) {
    return this.transaction(async()=>{
      const stale=await this.all(`SELECT g.id,g.user_id,o.goal_id AS owned FROM goals g LEFT JOIN goal_run_ownership o ON o.goal_id=g.id
        WHERE g.deleted_at IS NULL AND g.status NOT IN ('paused','stopped') AND ((g.status='executing' AND (o.goal_id IS NULL OR o.state!='running')) OR (o.state='running' AND o.lease_until<=?))`,[now]);
      for(const g of stale){
        await this.run("UPDATE goals SET status='needs_review',loop_status='interrupted' WHERE id=? AND status NOT IN ('paused','stopped')",[g.id]);
        if(g.owned)await this.run("UPDATE goal_run_ownership SET state='interrupted',reason='owner_expired_outcome_unknown' WHERE goal_id=?",[g.id]);
        else await this.run("INSERT INTO goal_run_ownership VALUES(?,?,?,'unknown',0,0,'interrupted','missing_owner_outcome_unknown','{}')",[g.id,g.user_id,randomUUID()]);
      }return stale.length;
    });
  }
}
