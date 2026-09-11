import sqlite3 from 'sqlite3';
import {withGoalRun} from './goalRunContext.js';
import {randomUUID} from 'node:crypto';
import db, {dbReady} from '../../models/database/index.js';
import {GoalRunOwnership} from '../../models/database/goalRunOwnership.js';

// Private connection keeps ownership transactions from absorbing unrelated SQL
// queued on the application's shared connection. No token/config secrets saved.
const bootId=randomUUID();
let storePromise;
let coordinatorTimer=null;let recovering=false;let cursor='';let stopCoordinator=null;
async function store() {
  await dbReady;
  if(!storePromise)storePromise=new Promise((resolve,reject)=>{
    const connection=new sqlite3.Database(db.filename,sqlite3.OPEN_READWRITE,async error=>{
      if(error){reject(error);return;}
      connection.configure('busyTimeout',5000);
      try{const result=new GoalRunOwnership(connection);await result.get('SELECT goal_id FROM goal_run_ownership LIMIT 1');resolve(result)}catch(e){connection.close(()=>{});storePromise=null;reject(e)}
    });
  });
  return storePromise;
}
export default {
  run:withGoalRun,
  async claimRemote(userId,nodeId,goalId) {return (await store()).claimRemote(userId,nodeId,Date.now(),goalId);},
  async renewRemote(userId,nodeId,lease,taskId) {return (await store()).renewRemote(userId,nodeId,lease,taskId);},
  async remoteResult(userId,nodeId,lease,taskId,output) {return (await store()).remoteResult(userId,nodeId,lease,taskId,output);},
  async waitRemote(lease,signal) {
    const s=await store();
    while(true){
      if(signal?.aborted||!await s.valid(lease))throw Object.assign(new Error('Goal ownership lost while waiting for remote work'),{name:'GoalCancelledError'});
      const rows=await s.all("SELECT t.status,t.claim_expires_at FROM goal_run_attempts a JOIN tasks t ON t.id=a.task_id WHERE a.goal_id=? AND a.run_id=? AND a.state='admitted' AND t.claimed_by IS NOT NULL",[lease.goalId,lease.runId]);
      if(!rows.length)return;
      if(rows.some(t=>t.status!=='running'||t.claim_expires_at<=Date.now()))throw Error('Remote task outcome unknown; reconciliation required');
      await new Promise(r=>setTimeout(r,250));
    }
  },
  async hasOwner(goalId) {return !!await (await store()).inspect(goalId);},
  async authorize(lease,config) {return (await store()).authorizeContinuation(lease,config);},
  async release(lease) {return (await store()).release(lease);},
  async valid(lease) {return (await store()).valid(lease);},
  startCoordinator(dispatch) {
    if(coordinatorTimer)return stopCoordinator;
    const tick=async()=>{
      if(recovering)return;recovering=true;
      try {
        const s=await store();await s.reconcile();
        const candidates=await s.all("SELECT goal_id FROM goal_run_ownership WHERE state='interrupted' AND goal_id>? ORDER BY goal_id LIMIT 16",[cursor]);
        if(!candidates.length)cursor='';
        for(const row of candidates){
          cursor=row.goal_id;
          const lease=await s.recover(row.goal_id,bootId);
          if(!lease)continue;
          // One recovery at a time. Existing task-wave spend admission remains
          // authoritative; this loop never replays admitted external work.
          try{await dispatch(lease)}catch(error){await s.release(lease);console.error('Goal recovery stopped:',error.message)}
          break;
        }
      }catch(error){console.error('Goal recovery coordinator:',error.message)}finally{recovering=false;}
    };
    coordinatorTimer=setInterval(tick,5000);coordinatorTimer.unref?.();void tick();
    stopCoordinator=()=>{clearInterval(coordinatorTimer);coordinatorTimer=null;};
    return stopCoordinator;
  },
  async acquire(goalId,userId) {const s=await store();await s.reconcile();return s.acquire(goalId,userId,bootId);},
  async inspect(goalId,userId) {
    const s=await store();
    const g=await s.get('SELECT user_id FROM goals WHERE id=?',[goalId]);
    if(!g||g.user_id!==userId)throw Error('Goal owner access denied');
    await s.reconcile();const o=await s.inspect(goalId);
    if(!o)return {state:'not_started'};
    const uncertainTasks=await s.all("SELECT task_id AS taskId,attempt_id AS attemptId,state FROM goal_run_attempts WHERE goal_id=? AND state='admitted'",[goalId]);
    const failures=await s.all('SELECT task_id AS taskId,attempt_id AS attemptId,recorded_at AS recordedAt,diagnostic FROM goal_run_failures WHERE goal_id=? AND run_id=? ORDER BY recorded_at',[goalId,o.run_id]);
    const failureEvidence=failures.map(f=>({...f,diagnostic:JSON.parse(f.diagnostic)}));
    let checkpoint;try{checkpoint=JSON.parse(o.checkpoint)}catch{checkpoint={phase:'invalid_checkpoint'}}
    return {state:o.state,runId:o.run_id,generation:o.generation,leaseUntil:o.lease_until,reason:o.reason,checkpoint,uncertainTasks,failureEvidence,automaticReplay:false,nextAction:uncertainTasks.length?'Reconcile every uncertain task using external evidence; do not retry blindly.':'Safe authorized checkpoints are considered by the recovery coordinator; otherwise inspect and explicitly resolve.'};
  },
  async resolve(goalId,userId,runId,body) {return (await store()).resolve(goalId,userId,runId,body);},
  async recordFailure(lease,taskId,error) {return (await store()).recordFailure(lease,taskId,error);},
  async beginAttempt(lease,taskId) {return (await store()).beginAttempt(lease,taskId);},
  async commitAttempt(lease,taskId,output) {return (await store()).commitAttempt(lease,taskId,output);},
  async checkpoint(lease,value) {return (await store()).checkpoint(lease,value);},
  watch(lease,entry,current,cancel) {
    let busy=false;
    const timer=setInterval(async()=>{
      if(busy)return;busy=true;
      try{
        const s=await store();
        if(!current()){clearInterval(timer);await s.release(lease);return;}
        if(!await s.renew(lease)){clearInterval(timer);cancel();await s.reconcile();}
      }catch{clearInterval(timer);cancel();}finally{busy=false;}
    },5000);
    timer.unref?.();
    // No automatic task replay on owner loss: external outcomes may be unknown.
    entry.abortController.signal.addEventListener('abort',()=>{
      clearInterval(timer);
      store().then(s=>s.release(lease)).catch(()=>{});
    },{once:true});
  },
};
