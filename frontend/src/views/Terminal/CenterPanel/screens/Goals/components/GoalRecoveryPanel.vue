<template>
  <section class="recovery-panel" aria-label="Goal recovery" @click.stop>
    <div class="recovery-heading">
      <span class="recovery-label">{{ loading ? 'Checking recovery…' : statusLabel }}</span>
      <button type="button" class="recovery-refresh" data-test="refresh" aria-label="Refresh recovery status" v-tooltip="'Refresh recovery status'" :disabled="loading || saving" @click="load">
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M13 6A5.2 5.2 0 1 0 13 10M13 2v4H9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>
    <p v-if="error" class="recovery-error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <template v-if="recovery">
      <p class="recovery-description" role="status">{{ statusDescription }}</p>
      <p v-if="recovery.state === 'interrupted' && recovery.nextAction">{{ recovery.nextAction }}</p>
      <ul v-if="recovery.uncertainTasks?.length" class="recovery-tasks"><li v-for="task in recovery.uncertainTasks" :key="task.attemptId"><code>{{ task.taskId }}</code><span>Outcome unconfirmed</span></li></ul>
      <details v-if="recovery.reason || recovery.runId" class="recovery-technical">
        <summary>Technical details</summary>
        <dl><dt>State</dt><dd>{{ recovery.state }}</dd><template v-if="recovery.reason"><dt>Reason</dt><dd>{{ recovery.reason }}</dd></template><template v-if="recovery.runId"><dt>Run</dt><dd>{{ recovery.runId }}</dd></template></dl>
      </details>
      <details v-if="recovery.state === 'interrupted'" class="recovery-evidence">
        <summary>Record verified recovery evidence</summary>
        <p>Verify each external action before retrying. Saving evidence does not start this goal.</p>
        <label class="recovery-field">Resolution JSON<textarea v-model="draft" rows="8" spellcheck="false" /></label>
        <p v-if="validation" role="status">{{ validation }}</p>
        <label class="recovery-confirm"><input v-model="confirmed" type="checkbox" /><span>I verified the evidence for every uncertain task.</span></label>
        <button type="button" class="recovery-save" data-test="resolve" :disabled="!payload || !confirmed || saving" @click="resolve">{{ saving ? 'Saving…' : 'Save recovery decision' }}</button>
      </details>
    </template>
  </section>
</template>
<script setup>
import {ref,computed,watch,onBeforeUnmount} from 'vue';
import {API_CONFIG} from '@/tt.config.js';
const props=defineProps({goalId:{type:String,required:true}});
const recovery=ref(null),draft=ref(''),confirmed=ref(false),loading=ref(false),saving=ref(false),error=ref(''),message=ref('');
const statusLabel=computed(()=>({not_started:'No recovery record',interrupted:'Recovery needs attention',running:'Run ownership active',released:'Run ownership released'}[recovery.value?.state] || 'Recovery status'));
const statusDescription=computed(()=>{
 const state=recovery.value?.state;
 if(state==='not_started')return 'Earlier work may still exist. No run ownership record is available for this goal.';
 if(state==='running')return 'A worker holds this run. Ownership alone does not confirm progress.';
 if(state==='released')return 'No worker holds this run. This is not a completion verdict.';
 if(state==='interrupted')return 'The run stopped or its outcome could not be confirmed. Check the evidence before retrying.';
 return 'Refresh to check the recorded run state.';
});
let epoch=0,controller;
const headers=()=>({'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('token')});
const validation=computed(()=>{
 if(!draft.value.trim())return 'Supply runId, evidence and one decision per uncertain task.';
 try{
  const p=JSON.parse(draft.value);const ids=(recovery.value?.uncertainTasks||[]).map(t=>t.taskId);
  if(p.runId!==recovery.value?.runId||typeof p.evidence!=='string'||p.evidence.trim().length<3||!Array.isArray(p.decisions))return 'Use the current run ID and describe the evidence.';
  if(p.decisions.length!==ids.length||new Set(p.decisions.map(d=>d?.taskId)).size!==ids.length)return 'Account for every uncertain task exactly once.';
  if(p.decisions.some(d=>!ids.includes(d?.taskId)||!['completed','not_executed'].includes(d.outcome)||typeof d.evidence!=='string'||d.evidence.trim().length<3||(d.outcome==='completed'&&(!d.output||typeof d.output!=='object'))))return 'Each decision needs a supported outcome and evidence; completed decisions also need verified output.';
  return '';
 }catch{return 'Enter valid JSON.';}
});
const payload=computed(()=>validation.value?null:JSON.parse(draft.value));
async function load(){
 const current=++epoch;controller?.abort();controller=new AbortController();recovery.value=null;confirmed.value=false;draft.value='';error.value='';loading.value=true;saving.value=false;
 try{const r=await fetch(`${API_CONFIG.BASE_URL}/goals/${encodeURIComponent(props.goalId)}/recovery`,{headers:headers(),credentials:'include',signal:controller.signal});const body=await r.json();if(current!==epoch)return;if(!r.ok)throw Error(body.error||'Recovery status unavailable');recovery.value=body;}
 catch(e){if(current===epoch)error.value=e.message;}finally{if(current===epoch)loading.value=false;}
}
async function resolve(){
 if(!payload.value||!confirmed.value||saving.value)return;
 const current=epoch;saving.value=true;error.value='';
 try{const r=await fetch(`${API_CONFIG.BASE_URL}/goals/${encodeURIComponent(props.goalId)}/recovery/resolve`,{method:'POST',headers:headers(),credentials:'include',body:JSON.stringify(payload.value),signal:controller.signal});const body=await r.json();if(current!==epoch)return;if(!r.ok)throw Error(body.error||'Resolution refused; refresh and review the evidence.');message.value='Recovery decision recorded. Execution was not started.';await load();}
 catch(e){if(current===epoch)error.value=e.message;}finally{if(current===epoch)saving.value=false;}
}
watch(()=>props.goalId,()=>{message.value='';void load();},{immediate:true});
onBeforeUnmount(()=>{epoch++;controller?.abort();});
</script>
<style scoped>
.recovery-panel { min-width: 0; padding: 8px 0 0; color: var(--color-text-muted); font: inherit; font-size: 11px; line-height: 1.5; text-align: left; }
.recovery-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.recovery-label { min-width: 0; color: var(--color-text); font-weight: 500; }
.recovery-panel p { margin: 5px 0 0; overflow-wrap: anywhere; }
.recovery-refresh { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 24px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--color-text-muted); cursor: pointer; }
.recovery-refresh:hover:not(:disabled) { color: var(--color-text); background: var(--color-darker-0); }
.recovery-panel button:focus-visible, .recovery-panel summary:focus-visible, .recovery-panel textarea:focus-visible, .recovery-panel input:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.recovery-panel button:disabled { cursor: not-allowed; opacity: .5; }
.recovery-tasks { list-style: none; padding: 0; margin: 8px 0; }
.recovery-tasks li { display: flex; flex-direction: column; padding: 4px 0; overflow-wrap: anywhere; }
.recovery-tasks code { font-family: var(--font-family-mono); font-size: 10px; }
.recovery-panel details { margin-top: 8px; }
.recovery-panel summary { cursor: pointer; overflow-wrap: anywhere; color: var(--color-text-muted); font-size: 11px; }
.recovery-panel summary:hover { color: var(--color-text); }
.recovery-technical dl { margin: 6px 0; font-size: 10px; }
.recovery-technical dt { margin-top: 4px; font-weight: 500; }
.recovery-technical dd { margin: 0; overflow-wrap: anywhere; font-family: var(--font-family-mono); }
.recovery-field { display: block; margin-top: 8px; }
.recovery-field textarea { display: block; width: 100%; max-width: 100%; min-height: 112px; box-sizing: border-box; resize: vertical; margin-top: 4px; padding: 8px; border: 1px solid var(--terminal-border-color); border-radius: 4px; color: var(--color-text); background: var(--color-darker-0); font: 10px/1.5 var(--font-family-mono); }
.recovery-confirm { display: flex; align-items: flex-start; gap: 6px; margin: 8px 0; }
.recovery-confirm input { flex: 0 0 auto; margin: 2px 0 0; accent-color: var(--color-primary); }
.recovery-save { max-width: 100%; padding: 6px 9px; border: 1px solid var(--terminal-border-color); border-radius: 4px; color: var(--color-text); background: var(--color-darker-0); font: inherit; cursor: pointer; white-space: normal; }
.recovery-error { color: var(--color-red); }
</style>
