import {describe,it,expect,vi,beforeAll,afterAll} from 'vitest';
import express from 'express';
const probe=vi.hoisted(()=>({inspect:vi.fn(async(id,user)=>{if(user!=='owner')throw Error('denied');return {state:'interrupted',reason:'external_outcome_unknown'}}),resolve:vi.fn(async()=>({resolved:true,started:false}))}));
vi.mock('../services/goal/GoalRunRecovery.js',()=>({default:probe}));
vi.mock('../services/GoalService.js',()=>({default:new Proxy({},{get:()=>((_req,res)=>res.json({stub:true}))})}));
vi.mock('./Middleware.js',()=>({authenticateToken:(req,res,next)=>{if(!req.headers['x-test-user'])return res.sendStatus(401);req.user={id:req.headers['x-test-user']};next()}}));
import routes from './GoalRoutes.js';
let server,url;beforeAll(async()=>{const app=express();app.use(express.json());app.use('/goals',routes);server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));url='http://127.0.0.1:'+server.address().port});afterAll(()=>new Promise(r=>server.close(r)));
describe('Given authenticated recovery operations',()=>{
 it('When no session is provided, Then state is not disclosed',async()=>expect((await fetch(url+'/goals/g/recovery')).status).toBe(401));
 it('When another owner requests state, Then it is not disclosed',async()=>expect((await fetch(url+'/goals/g/recovery',{headers:{'x-test-user':'other'}})).status).toBe(404));
 it('When owner inspects, Then the interruption reason is actionable',async()=>expect(await (await fetch(url+'/goals/g/recovery',{headers:{'x-test-user':'owner'}})).json()).toMatchObject({reason:'external_outcome_unknown'}));
 it('When malformed resolution is posted, Then no recovery decision is executed',async()=>{
  probe.resolve.mockClear();const r=await fetch(url+'/goals/g/recovery/resolve',{method:'POST',headers:{'x-test-user':'owner','Content-Type':'application/json'},body:JSON.stringify({runId:3,decisions:'retry'})});
  expect(r.status).toBe(400);expect(probe.resolve).not.toHaveBeenCalled();
 });
 it('When valid evidence is posted, Then it is bound to authenticated owner and does not execute',async()=>{
  const b={runId:'r',evidence:'checked provider operation',decisions:[]};const r=await fetch(url+'/goals/g/recovery/resolve',{method:'POST',headers:{'x-test-user':'owner','Content-Type':'application/json'},body:JSON.stringify(b)});
  expect(await r.json()).toEqual({resolved:true,started:false});expect(probe.resolve).toHaveBeenCalledWith('g','owner','r',b);
 });
});
