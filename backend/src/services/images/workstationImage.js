import { validatePng } from './pngIntegrity.js';
import { localImageJson } from './localImageHttp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import PathManager from '../../utils/PathManager.js';

// Operator configuration only; never accept an endpoint or output path from
// tool/browser arguments. This is the teacher-prep facade, NOT OpenAI API.
export function workstationImageUrl(value = process.env.AGNT_WORKSTATION_IMAGE_URL) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Workstation image URL must be a loopback HTTP origin');
  return url.origin;
}
export const WORKSTATION_IMAGE_CAPABILITY = Object.freeze({models:['provider-default'],operations:['generate'],defaultModel:'provider-default',supportedFormats:['b64_json'],maxImages:1,supportsQuality:false,supportsStyle:false});
async function health(base, fetcher) {
  const response = await fetcher(base+'/image/health',{redirect:'error',signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error('Local image facade unavailable');
  const data = await response.json();
  if (data.service !== 'teacher-prep-image-service' || data.status !== 'ok' || typeof data.model_id !== 'string' || typeof data.profile_id !== 'string') throw new Error('Unexpected local image facade');
  return data;
}
const binding = (base,data) => crypto.createHash('sha256').update(JSON.stringify([base,data.profile_id,data.model_id])).digest('hex');
export async function workstationImageConnection(userId) {
  const base=workstationImageUrl();if(!base)return null;
  let data;try {data=await health(base,fetch);}catch{return {id:'workstation-image',provider:'workstation-image',ownerId:userId,binding:'unavailable',connected:false,requiresConsent:false,operations:['generate'],models:['provider-default'],label:'Workstation image lane',billing:'Local generation only. Start and admit the lane through its owner controls.'};}
  return {id:'workstation-image',provider:'workstation-image',ownerId:userId,binding:binding(base,data),connected:true,requiresConsent:false,operations:['generate'],models:['provider-default'],label:'Workstation image lane',billing:`Local GPU · ${data.model_id} · ${data.pipeline_loaded?'loaded':'cold; admission/load required'}. Generation only. Check profile licensing; canary is not product promotion.`};
}
export async function generateWorkstationImage(params,{fetcher=fetch,requester=fetcher===fetch?localImageJson:fetcher,root=PathManager.getDataDir()}={}) {
  const base=workstationImageUrl();if(!base)throw new Error('Local image lane is not configured');
  if (params.imageOperation && params.imageOperation!=='Generate') throw new Error('Local facade does not support editing; select an edit-capable image provider explicitly');
  if (params.model && params.model!=='provider-default') throw new Error('Local model is selected by the workstation operator');
  if (params.numberOfImages!=null && params.numberOfImages!==1) throw new Error('Local facade supports one image per request');
  if (params.referenceImage || params.imageSize || params.imageQuality || params.imageStyle || params.aspectRatio) throw new Error('Unsupported local image control; not silently discarded');
  if (typeof params.imagePrompt!=='string' || !params.imagePrompt.trim() || params.imagePrompt.length>16000) throw new Error('Invalid local image prompt');
  if (!params.beforeImageDispatch || !params.imageRequest) throw new Error('Saved image selection required');
  const controller=new AbortController();const abort=()=>controller.abort();params.signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(abort,630000);let dispatched=false,requestId=null,dir=null;
  try {
    if(params.signal?.aborted)throw new Error('Cancelled before dispatch');
    const before=await health(base,fetcher);
    if(binding(base,before)!==params.imageRequest.binding)throw new Error('Local image profile changed; reload image settings');
    dir=await fs.mkdtemp(path.join(await fs.mkdir(path.join(root,'local-image-jobs'),{recursive:true}).then(()=>path.join(root,'local-image-jobs')),'request-'));
    requestId=crypto.randomUUID();
    const body={request_kind:'teacher_prep_image_apply',output_dir:dir,sequence_index:0,image_plan_item:{slug:requestId,prompt:params.imagePrompt}};
    await params.beforeImageDispatch();if(controller.signal.aborted)throw new Error('Cancelled before dispatch');
    const start=Date.now();
    await fs.writeFile(path.join(dir,'request.json'),JSON.stringify({requestId,startedAt:new Date().toISOString(),profile:before.profile_id,prompt:params.imagePrompt}),{flag:'wx',mode:0o600});
    dispatched=true;
    const response=await requester(base+'/image/generate',{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    await fs.writeFile(path.join(dir,'response.json'),JSON.stringify({httpStatus:response.status,data}),{flag:'wx',mode:0o600});
    if(!response.ok)throw Object.assign(new Error(response.status===503?'Local image admission is pending or blocked. No image retry or provider fallback was attempted.':'Local image generation failed; inspect receipt before retrying'),{httpStatus:response.status});
    if(data.images?.length!==1 || data.image_model!==before.model_id)throw new Error('Unexpected local image result');
    const item=data.images[0];if(typeof item.path!=='string'||path.isAbsolute(item.path))throw new Error('Invalid local image result path');
    const real=await fs.realpath(path.resolve(dir,item.path));if(!real.startsWith(dir+path.sep))throw new Error('Local image escaped request directory');
    const stat=await fs.stat(real);if(!stat.isFile()||stat.size>16*1024*1024)throw new Error('Invalid local image size');
    const bytes=await fs.readFile(real);validatePng(bytes);
    return {generatedImages:['data:image/png;base64,'+bytes.toString('base64')],imageMetadata:{provider:'workstation-image',requestedModel:'provider-default',resolvedModel:null,returnedModel:data.image_model,selectionMode:'operator-selected',modelIdentityVerified:false,operation:'Generate',width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),profile:before.profile_id,pipelineInitiallyLoaded:before.pipeline_loaded,durationMs:Date.now()-start,requestId,receiptDirectory:dir,usage:null,cost:null}};
  } catch(error) {error.retryable=false;error.remoteOutcomeUnknown=dispatched;error.requestId=requestId;error.receiptDirectory=dir;
    if(dir)await fs.writeFile(path.join(dir,'failure.json'),JSON.stringify({requestId,dispatched,error:error.message,code:error.code??null,remoteOutcomeUnknown:dispatched,retryable:false,at:new Date().toISOString()}),{flag:'wx',mode:0o600}).catch(()=>{});
    throw error;}
  finally {clearTimeout(timer);params.signal?.removeEventListener('abort',abort);}
}
