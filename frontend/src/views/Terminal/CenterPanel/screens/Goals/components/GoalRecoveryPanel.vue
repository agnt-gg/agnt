<template>
  <section class="recovery-panel" aria-label="Goal recovery" @click.stop>
    <strong>Goal recovery</strong>
    <button type="button" data-test="refresh" @click="load">Refresh recovery status</button>
    <p v-if="loading" role="status">Checking run ownership…</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <template v-if="recovery">
      <p>{{ recovery.state }} · {{ recovery.reason || 'No interruption recorded' }}</p>
      <p>{{ recovery.nextAction }}</p>
      <ul><li v-for="task in recovery.uncertainTasks || []" :key="task.attemptId">{{ task.taskId }} — outcome unconfirmed</li></ul>
      <details v-if="recovery.state === 'interrupted'">
        <summary>Record verified recovery evidence</summary>
        <p>Do not retry blindly. Verify each external action first. This records your evidence; it does not independently prove the action’s outcome or start the goal.</p>
        <label>Resolution JSON<textarea v-model="draft" rows="8" spellcheck="false" /></label>
        <p v-if="validation" role="status">{{ validation }}</p>
        <label><input v-model="confirmed" type="checkbox" /> I verified the evidence for every uncertain task.</label>
        <button type="button" data-test="resolve" :disabled="!payload || !confirmed || saving" @click="resolve">Save recovery decision</button>
      </details>
    </template>
  </section>
</template>
<script setup>
import {ref,computed,watch,onBeforeUnmount} from 'vue';
import {API_CONFIG} from '@/tt.config.js';
const props=defineProps({goalId:{type:String,required:true}});
const recovery=ref(null),draft=ref(''),confirmed=ref(false),loading=ref(false),saving=ref(false),error=ref(''),message=ref('');
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
.recovery-panel { padding: 12px; border: 1px solid var(--terminal-border-color); border-radius: 6px; color: var(--color-text); background: var(--color-background); }
p, li { overflow-wrap: anywhere; }
textarea { display: block; width: 100%; box-sizing: border-box; color: inherit; background: var(--color-darker-0); }
button { margin: 6px; cursor: pointer; } button:disabled { cursor: not-allowed; opacity: .5; }
</style>
