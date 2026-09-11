// Dependency-injected SQLite store: importing this module never opens production data.
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID,createHash} from 'node:crypto';
export class GoalRunOwnership {
  constructor(db) { this.db=db; this.queue=Promise.resolve(); this.context=new AsyncLocalStorage(); }
  serialize(fn) {
    const active=this.context.getStore();
    if(active?.store===this && active.active)return fn();
    const token={store:this,active:true};
    const work=this.queue.catch(()=>{}).then(()=>this.context.run(token,async()=>{try{return await fn()}finally{token.active=false}}));
    this.queue=work;return work;
  }
  run(sql,p=[]) { return this.serialize(()=>new Promise((resolve,reject)=>this.db.run(sql,p,function(e){e?reject(e):resolve(this.changes)}))); }
  get(sql,p=[]) { return this.serialize(()=>new Promise((resolve,reject)=>this.db.get(sql,p,(e,r)=>e?reject(e):resolve(r)))); }
  all(sql,p=[]) { return this.serialize(()=>new Promise((resolve,reject)=>this.db.all(sql,p,(e,r)=>e?reject(e):resolve(r)))); }
  transaction(fn) {
    return this.serialize(async()=>{
      await this.run('BEGIN IMMEDIATE');let committing=false;
      try {const result=await fn();committing=true;await this.run('COMMIT');return result}
      catch(error) {
        await this.run('ROLLBACK').catch(()=>{});
        if(committing)throw Object.assign(new Error('Recovery commit outcome unknown; inspect before retrying.'),{code:'RECOVERY_COMMIT_UNKNOWN',retryable:false});
        throw error;
      }
    });
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
      await this.run(`CREATE TRIGGER IF NOT EXISTS goal_recovery_task_${event.toLowerCase()} AFTER ${event==='UPDATE'?'UPDATE OF status, output, goal_id, title, description, required_tools, dependencies, error':event} ON tasks BEGIN
        INSERT INTO goal_recovery_task_versions VALUES(${row}.id,1) ON CONFLICT(task_id) DO UPDATE SET revision=revision+1;
      END`);
    }
    await this.run('CREATE TABLE IF NOT EXISTS goal_run_attempt_history(goal_id TEXT,run_id TEXT,generation INTEGER,task_id TEXT,state TEXT,attempt_id TEXT,task_revision INTEGER,recorded_at INTEGER)');
    for(const event of ['INSERT','UPDATE'])await this.run(`CREATE TRIGGER IF NOT EXISTS goal_attempt_history_${event.toLowerCase()} AFTER ${event} ON goal_run_attempts BEGIN
      INSERT INTO goal_run_attempt_history VALUES(NEW.goal_id,NEW.run_id,NEW.generation,NEW.task_id,NEW.state,NEW.attempt_id,NEW.task_revision,CAST(strftime('%s','now') AS INTEGER)*1000);
    END`);
    await this.run(`CREATE TABLE IF NOT EXISTS goal_run_authorizations(run_id TEXT PRIMARY KEY,goal_id TEXT NOT NULL,user_id TEXT NOT NULL,scope_hash TEXT NOT NULL,config TEXT NOT NULL,recoveries INTEGER NOT NULL DEFAULT 0)`);
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
      const changed=await this.run("UPDATE tasks SET status=?,output=?,progress=100,completed_at=?,updated_at=? WHERE id=? AND goal_id=?",[output.recoveryTaskFailed?'failed':'completed',JSON.stringify(output),new Date(now).toISOString(),new Date(now).toISOString(),taskId,l.goalId]);
      if(changed!==1)throw Error('Task disappeared during result commit');
      if(!output.recoveryTaskFailed)await this.run("UPDATE goal_run_attempts SET state='committed' WHERE goal_id=? AND run_id=? AND task_id=?",[l.goalId,l.runId,taskId]);
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
        let changed;
        if(d.outcome==='not_executed')changed=await this.run("UPDATE tasks SET status='pending',error=NULL WHERE id=? AND goal_id=?",[d.taskId,goalId]);
        else changed=await this.run("UPDATE tasks SET status='completed',output=?,progress=100,completed_at=?,updated_at=? WHERE id=? AND goal_id=?",[JSON.stringify(d.output),new Date(now).toISOString(),new Date(now).toISOString(),d.taskId,goalId]);
        if(changed!==1)throw Error('Resolution task missing or moved; barrier retained');
        await this.run("UPDATE goal_run_attempts SET state=? WHERE goal_id=? AND task_id=? AND state='admitted'",['resolved_'+d.outcome,goalId,d.taskId]);
      }
      await this.run('INSERT INTO goal_run_resolutions VALUES(?,?,?,?,?,?,?)',[randomUUID(),goalId,runId,userId,now,evidence,JSON.stringify(decisions)]);
      await this.run("UPDATE goal_run_ownership SET state='released',reason='outcome_reconciled' WHERE goal_id=? AND run_id=?",[goalId,runId]);
      // Resolving evidence does not start execution or override a pause/stop.
      return {resolved:true,started:false};
    });
  }
  async scopeHash(goalId) {
    const g=await this.get('SELECT * FROM goals WHERE id=?',[goalId]);
    const tasks=await this.all('SELECT * FROM tasks WHERE goal_id=? ORDER BY id',[goalId]);
    const fields=(obj,keys)=>Object.fromEntries(keys.map(k=>[k,obj[k]??null]));
    return createHash('sha256').update(JSON.stringify({goal:fields(g,['id','user_id','title','description','success_criteria']),tasks:tasks.map(t=>fields(t,['id','goal_id','title','description','required_tools','dependencies','order_index']))})).digest('hex');
  }
  authorizeContinuation(l,config,now=Date.now()) {
    return this.transaction(async()=>{
      if(!await this.valid(l,now))return false;
      if(!['autonomous','normal'].includes(config.mode)||!Number.isSafeInteger(config.maxIterations)||config.maxIterations<1||config.maxIterations>1000)throw Error('Invalid continuation authorization');
      const safe={mode:config.mode,maxIterations:config.maxIterations,provider:config.provider||null,model:config.model||null,conversationId:config.conversationId||null};
      await this.run('INSERT INTO goal_run_authorizations VALUES(?,?,?,?,?,0)',[l.runId,l.goalId,l.userId,await this.scopeHash(l.goalId),JSON.stringify(safe)]);return true;
    });
  }
  valid(l,now=Date.now()) {
    return this.get(`SELECT 1 FROM goal_run_ownership o JOIN goals g ON g.id=o.goal_id WHERE o.goal_id=? AND o.user_id=? AND o.run_id=? AND o.generation=? AND o.state='running' AND o.lease_until>? AND g.user_id=? AND g.deleted_at IS NULL AND g.status NOT IN ('paused','stopped')`,[l.goalId,l.userId,l.runId,l.generation,now,l.userId]).then(Boolean);
  }
  recover(goalId,bootId,now=Date.now()) {
    return this.transaction(async()=>{
      const o=await this.inspect(goalId),g=await this.get('SELECT * FROM goals WHERE id=?',[goalId]);
      if(!o||o.state!=='interrupted'||!g||g.deleted_at||g.status!=='needs_review'||g.loop_status!=='interrupted'||g.user_id!==o.user_id)return null;
      const auth=await this.get('SELECT * FROM goal_run_authorizations WHERE run_id=? AND goal_id=? AND user_id=?',[o.run_id,goalId,g.user_id]);
      if(!auth||auth.recoveries>=3||auth.scope_hash!==await this.scopeHash(goalId))return null;
      let checkpoint,config;try{checkpoint=JSON.parse(o.checkpoint);config=JSON.parse(auth.config)}catch{return null}
      if(!['tasks','evaluate'].includes(checkpoint.phase)||!Number.isSafeInteger(checkpoint.iteration)||checkpoint.iteration<1||checkpoint.iteration>config.maxIterations)return null;
      if(await this.get("SELECT 1 FROM goal_run_attempts WHERE goal_id=? AND state='admitted' LIMIT 1",[goalId]))return null;
      if(await this.get("SELECT 1 FROM tasks WHERE goal_id=? AND status NOT IN ('pending','completed') LIMIT 1",[goalId]))return null;
      if(checkpoint.phase==='evaluate'&&await this.get("SELECT 1 FROM tasks WHERE goal_id=? AND status!='completed' LIMIT 1",[goalId]))return null;
      const l={goalId,userId:g.user_id,runId:randomUUID(),bootId,generation:o.generation+1,resume:checkpoint,config};
      await this.run("UPDATE goal_run_ownership SET run_id=?,boot_id=?,generation=?,lease_until=?,state='running',reason='safe_checkpoint_recovered' WHERE goal_id=?",[l.runId,bootId,l.generation,now+30000,goalId]);
      await this.run('INSERT INTO goal_run_authorizations VALUES(?,?,?,?,?,?)',[l.runId,goalId,g.user_id,auth.scope_hash,auth.config,auth.recoveries+1]);
      await this.run("UPDATE goals SET status='executing',loop_status='recovering' WHERE id=?",[goalId]);
      return l;
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
        [goalId,userId,lease.runId,bootId,lease.generation,now+30000]);
      // Explicit start/resume changes intent atomically with acquiring ownership.
      await this.run("UPDATE goals SET status='executing' WHERE id=? AND user_id=?",[goalId,userId]);
      return lease;
    });
  }
  renew(l,now=Date.now()) {return this.run("UPDATE goal_run_ownership SET lease_until=? WHERE goal_id=? AND run_id=? AND generation=? AND state='running' AND lease_until>? AND EXISTS(SELECT 1 FROM goals g WHERE g.id=goal_run_ownership.goal_id AND g.user_id=goal_run_ownership.user_id AND g.deleted_at IS NULL AND g.status NOT IN ('paused','stopped'))",[now+30000,l.goalId,l.runId,l.generation,now]).then(n=>n===1);}
  release(l) {
    return this.transaction(async()=>{
      const current=await this.inspect(l.goalId);
      if(!current||current.run_id!==l.runId||current.generation!==l.generation||current.state!=='running')return false;
      const checkpoint=JSON.parse(current.checkpoint);
      const unresolved=checkpoint.phase==='external_work_admitted'||!!await this.get("SELECT 1 FROM goal_run_attempts WHERE goal_id=? AND state='admitted' LIMIT 1",[l.goalId]);
      return (await this.run("UPDATE goal_run_ownership SET state=?,reason=?,lease_until=0 WHERE goal_id=? AND run_id=? AND generation=?",[unresolved?'interrupted':'released',unresolved?'external_outcome_unknown':null,l.goalId,l.runId,l.generation]))===1;
    });
  }
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
