import express from 'express';
import { authenticateToken } from './Middleware.js';
import { getLearningCoordinator } from '../services/learning/LearningCoordinator.js';

export function createLearningRoutes(getCoordinator = getLearningCoordinator) {
  const router=express.Router();router.use(authenticateToken);
  const handle=fn=>async(req,res)=>{try{const service=await getCoordinator();res.json({success:true,...await fn(service,req)});}catch(error){
    console.error('[Learning API]',error.code||'internal_error');res.status(error.status||500).json({success:false,error:error.code||'learning_unavailable'});
  }};
  router.get('/',handle((s,r)=>s.summary(r.user.userId)));
  router.get('/events',handle(async(s,r)=>({events:await s.all('SELECT id,work_id,type,capability,outcome,error_kind,trial_id,occurred_at,payload_json FROM learning_events WHERE user_id=? ORDER BY occurred_at DESC LIMIT 200',[r.user.userId])})));
  router.post('/settings',handle((s,r)=>s.setPaused(r.user.userId,r.body.paused)));
  router.post('/findings/:id/approve',handle(async(s,r)=>({trial:await s.approve(r.user.userId,r.params.id,r.body)})));
  router.post('/findings/:id/dismiss',handle((s,r)=>s.dismiss(r.user.userId,r.params.id,r.body.revision)));
  router.post('/trials/:id/keep',handle(async(s,r)=>({policy:await s.keep(r.user.userId,r.params.id,r.body.revision,r.body.candidateHash)})));
  router.post('/trials/:id/undo',handle((s,r)=>s.undo(r.user.userId,r.params.id,r.body.revision)));
  return router;
}
export default createLearningRoutes();
