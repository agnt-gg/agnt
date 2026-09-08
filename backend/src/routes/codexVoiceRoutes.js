import express from 'express';
import { requireAuthHeader } from '../utils/authGuard.js';
import { createCodexVoiceCall, getCodexVoiceStatus, CodexVoiceError } from '../services/codexRealtimeVoiceService.js';

/** Mounted on the existing authenticated speech surface. Dependencies for route tests. */
export function createCodexVoiceRouter({auth=requireAuthHeader,createCall=createCodexVoiceCall,status=getCodexVoiceStatus}={}) {
  const router=express.Router();
  router.get('/capabilities',auth,async(req,res)=>{
    try {res.json({success:true,...await status(req.query.provider||'openai-codex')});}
    catch {res.status(502).json({success:false,code:'voice_status_failed'});}
  });
  router.post('/call',auth,express.text({type:['application/sdp','text/plain'],limit:'256kb'}),async(req,res)=>{
    const controller=new AbortController();
    const abort=()=>{if(!res.writableEnded)controller.abort();};
    req.once('aborted',abort);res.once('close',abort);
    try {
      const result=await createCall({provider:req.query.provider||'openai-codex',voice:req.query.voice||'cove',sdp:req.body,signal:controller.signal});
      if(!res.destroyed)res.type('application/sdp').send(result.sdp);
    } catch(error) {
      if(!res.destroyed)res.status(error instanceof CodexVoiceError?error.status:502).json({success:false,code:error instanceof CodexVoiceError?error.code:'voice_setup_failed'});
    } finally {req.removeListener('aborted',abort);res.removeListener('close',abort);}
  });
  return router;
}
