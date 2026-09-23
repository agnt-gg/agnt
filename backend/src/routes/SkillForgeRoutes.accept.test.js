import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
const accept=vi.fn();
vi.mock('../services/evolution/SkillDraftService.js',()=>({default:{accept:(...args)=>accept(...args)}}));
vi.mock('../services/goal/SkillForgeOrchestrator.js',()=>({default:{}}));
vi.mock('../models/SkillEvalModel.js',()=>({default:{}}));
vi.mock('../models/SkillVersionModel.js',()=>({default:{}}));
vi.mock('./Middleware.js',()=>({authenticateToken:(req,res,next)=>{
  if(req.headers.authorization!=='Bearer fixture') return res.status(401).json({error:'Unauthorized'});
  req.user={userId:'owner'};next();
}}));
const {default:routes}=await import('./SkillForgeRoutes.js');
let server,base;
beforeAll(async()=>{
  const app=express();app.use(express.json());app.use('/api/skillforge',routes);
  await new Promise(resolve=>{server=app.listen(0,'127.0.0.1',resolve)});
  base='http://127.0.0.1:'+server.address().port;
});
afterAll(()=>new Promise(resolve=>server.close(resolve)));
const request=(body,authenticated=true)=>fetch(base+'/api/skillforge/skill/skill-id/versions/version-id/accept',{method:'POST',headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify(body)});
describe('explicit skill version acceptance route',()=>{
  it('requires authentication and explicit confirmation',async()=>{
    expect((await request({confirm:true,contentHash:'hash'},false)).status).toBe(401);
    expect((await request({contentHash:'hash'})).status).toBe(400);
    expect((await request({confirm:true})).status).toBe(400);
    expect(accept).not.toHaveBeenCalled();
  });
  it('passes server identity and exact version/hash, never body-supplied owner',async()=>{
    accept.mockResolvedValue({status:'accepted',version:2});
    const response=await request({confirm:true,contentHash:'expected',userId:'intruder'});
    expect(response.status).toBe(200);
    expect(accept).toHaveBeenCalledWith('skill-id','version-id','owner','expected');
    expect((await response.json()).result.status).toBe('accepted');
  });
  it('reports a stale or unavailable draft without claiming success',async()=>{
    accept.mockRejectedValue(new Error('Draft changed or is not pending'));
    const response=await request({confirm:true,contentHash:'stale'});
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('Draft changed');
  });
});
