import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('axios',()=>({default:{get:vi.fn()}}));
vi.mock('../../utils/PathManager.js',()=>({default:{getDataPath:()=>'/unused'}}));
vi.mock('./sessionTokenCache.js',()=>({getSessionToken:vi.fn(id=>id==='paid'?'paid-token':id==='free'?'free-token':null),getSessionUserId:()=> 'paid'}));
import axios from 'axios';
import { getSessionToken } from './sessionTokenCache.js';
import { canRunScheduledGoals, requireScheduledGoals } from './planEntitlements.js';
beforeEach(()=>{vi.clearAllMocks();process.env.REMOTE_URL='https://example.invalid/api';axios.get.mockImplementation(async(_url,opts)=>({data:{planType:opts.headers.Authorization.includes('paid-token')?'personal':'free'}}));});
describe('Paid scheduling entitlement',()=>{
 it('uses the scheduled owner, not the most recently active paid account',async()=>{
  expect(await canRunScheduledGoals('free')).toBe(false);expect(getSessionToken).toHaveBeenCalledWith('free');
  expect(await canRunScheduledGoals('paid')).toBe(true);
  expect(await canRunScheduledGoals('unknown')).toBe(false);
 });
 it('rejects a free request with an upgrade response, not an auth failure',async()=>{
  const res={status:vi.fn().mockReturnThis(),json:vi.fn()};const next=vi.fn();
  await requireScheduledGoals({method:'POST',user:{userId:'free'},body:{}},res,next);
  expect(res.status).toHaveBeenCalledWith(403);expect(res.json).toHaveBeenCalledWith(expect.objectContaining({requiredFeature:'scheduledGoals'}));expect(next).not.toHaveBeenCalled();
 });
 it.each([['DELETE',{}],['PATCH',{enabled:false}]])('lets a downgraded owner stop/remove schedules through %s',async(method,body)=>{
  const next=vi.fn();await requireScheduledGoals({method,body,user:{userId:'free'}},{},next);expect(next).toHaveBeenCalledOnce();
 });
 it('does not let a pause request smuggle in cron changes',async()=>{
  const res={status:vi.fn().mockReturnThis(),json:vi.fn()};const next=vi.fn();
  await requireScheduledGoals({method:'PATCH',body:{enabled:false,cron:'* * * * *'},user:{userId:'free'}},res,next);expect(next).not.toHaveBeenCalled();
 });
});
