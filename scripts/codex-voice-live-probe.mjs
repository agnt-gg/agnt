// Bounded opt-in live media probe. Imports production router/controller; no auth mocks.
// User initiated. Does not open room mic, log SDP/credentials, or restart production.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
if(process.env.AGNT_LIVE_VOICE_TEST!=='1')throw new Error('Set AGNT_LIVE_VOICE_TEST=1 to authorize a real voice connection.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=await fs.mkdtemp(path.join(process.env.AGNT_TEST_ARTIFACT_ROOT||path.dirname(root),'codex-live-probe-'));
await fs.mkdir(path.join(evidence,'data','Data'),{recursive:true});
await fs.writeFile(path.join(evidence,'data','Data','agnt.db'),'');
process.env.USER_DATA_PATH=path.join(evidence,'data');
process.env.NODE_ENV='test';
delete process.env.AGNT_HOME;
// Provider uses normal existing runtime auth; application login guard untouched.
await import('../backend/src/config/envDefaults.js');
const {default:express}=await import('express');
const {createCodexVoiceRouter}=await import('../backend/src/routes/codexVoiceRoutes.js');
const {chromium}=await import('playwright');
const app=express();app.use('/api/speech/codex',createCodexVoiceRouter());
app.use('/modules',express.static(path.join(root,'frontend/src/voice')));
app.get('/',(req,res)=>res.type('html').send('<!doctype html><title>Isolated Codex media test</title><p>Synthetic input only.</p>'));
const server=app.listen(0,'127.0.0.1');await once(server,'listening');
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;let summary={kind:'real-codex-connection-with-synthetic-silence',evidence,accountSlot:'openai-codex',productionRouter:true,productionController:true,realMicrophone:false};
try{
 if(!process.env.AGNT_AUTH_TOKEN)throw new Error('agnt_token_not_injected');
 browser=await chromium.launch({executablePath:process.env.AGNT_TEST_BROWSER || '/usr/bin/chromium',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']});
 const page=await browser.newPage();
 // Only AGNT token added to the exact ephemeral origin; never any provider token.
 await page.route(origin+'/**',async route=>{await route.continue({headers:{...route.request().headers(),authorization:'Bearer '+process.env.AGNT_AUTH_TOKEN}});});
 const http=[];page.on('response',r=>{if(r.url().startsWith(origin+'/api/'))http.push({route:new URL(r.url()).pathname,status:r.status()});});
 await page.goto(origin);
 const result=await page.evaluate(async()=>{
  const {createCodexVoiceController}=await import('/modules/codexVoiceController.js');
  const context=new AudioContext({sampleRate:24000});await context.resume();
  const destination=context.createMediaStreamDestination();
  // Silent generated track, never navigator.getUserMedia.
  const oscillator=context.createOscillator(),gain=context.createGain();gain.gain.value=0;oscillator.connect(gain).connect(destination);oscillator.start();
  const states=[],errors=[],transcripts=[];
  const controller=createCodexVoiceController({apiBase:'/api',getToken:()=>'',submitTurn:async()=>({accepted:false,reason:'probe_no_dispatch'}),getUserMedia:async()=>destination.stream,onState:s=>states.push(s),onError:e=>errors.push(e),onTranscript:e=>transcripts.push({role:e.role,final:e.final})});
  const startedAt=performance.now();
  try{const connected=await controller.start();if(connected)await new Promise(r=>setTimeout(r,1500));return {connected,states,errors,transcriptEvents:transcripts,setupMs:Math.round(performance.now()-startedAt)};}
  finally{controller.stop();oscillator.stop();await context.close();}
 });
 summary={...summary,...result,http};
}catch(error){summary.error=String(error.message).replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,600);}
finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
await fs.writeFile(path.join(evidence,'summary.json'),JSON.stringify(summary,null,2));
console.log('PROBE_RESULT '+JSON.stringify(summary));
// Runtime imports may install background timers; probe owns this process only.
process.exit(summary.connected?0:2);
