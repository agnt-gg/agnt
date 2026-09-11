import sqlite3 from 'sqlite3';
import {randomUUID} from 'node:crypto';
import db, {dbReady} from '../../models/database/index.js';
import {GoalRunOwnership} from '../../models/database/goalRunOwnership.js';

// Private connection keeps ownership transactions from absorbing unrelated SQL
// queued on the application's shared connection. No token/config secrets saved.
const bootId=randomUUID();
let storePromise;
async function store() {
  await dbReady;
  if(!storePromise)storePromise=new Promise((resolve,reject)=>{
    const connection=new sqlite3.Database(db.filename,sqlite3.OPEN_READWRITE,async error=>{
      if(error){reject(error);return;}
      connection.configure('busyTimeout',5000);
      try{const result=new GoalRunOwnership(connection);await result.initialize();resolve(result)}catch(e){reject(e)}
    });
  });
  return storePromise;
}
export default {
  async acquire(goalId,userId) {const s=await store();await s.reconcile();return s.acquire(goalId,userId,bootId);},
  async inspect(goalId,userId) {
    const s=await store();
    const g=await s.get('SELECT user_id FROM goals WHERE id=?',[goalId]);
    if(!g||g.user_id!==userId)throw Error('Goal owner access denied');
    await s.reconcile();const o=await s.inspect(goalId);
    if(!o)return {state:'not_started'};
    return {state:o.state,runId:o.run_id,generation:o.generation,leaseUntil:o.lease_until,reason:o.reason,checkpoint:JSON.parse(o.checkpoint),automaticReplay:false};
  },
  async resolve(goalId,userId,runId,body) {return (await store()).resolve(goalId,userId,runId,body);},
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
