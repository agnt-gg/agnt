<template>
  <section class="image-settings" aria-label="Image generation settings">
    <button v-if="compact" type="button" class="image-settings-toggle" @click="open = !open">Images: {{ selected?.label || 'Configure provider' }}</button>
    <div v-if="!compact || open" class="image-settings-panel">
      <h3>Image generation</h3><p>Independent of your conversation model. No automatic provider fallback.</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <label>Image provider</label>
      <CustomSelect :disabled="busy" :options="providerOptions" :model-value="draftConnection" placeholder="Select image provider" @update:model-value="choose" />
      <p v-if="selected" class="billing">{{ selected.billing }}</p>
      <template v-if="selected?.provider === 'openai'">
        <label>Image model</label>
        <CustomSelect :disabled="busy" :options="modelOptions" :model-value="mode" @update:model-value="setMode" />
        <input v-if="mode === 'pinned'" v-model="pin" :disabled="busy" aria-label="Exact image model ID" placeholder="Exact model or snapshot ID" />
        <p>Automatic choices refresh at execution. Availability and costs can change; exact pins stay unchanged.</p>
      </template>
      <template v-else-if="selected && !selected.requiresConsent">
        <label>Image model</label><CustomSelect :disabled="busy" :options="(selected.models || []).map(model => ({ label: model, value: model }))" :model-value="pin" @update:model-value="pin = $event" />
      </template>
      <template v-if="selected?.requiresConsent">
        <p>Model selected by Codex. Engine version is not reported.</p>
        <label><input type="checkbox" :disabled="busy" v-model="allow" data-test="image-subscription-consent" /> Allow image generation using this subscription’s allowance</label>
      </template>
      <button v-if="selected?.requiresConsent" type="button" data-test="image-consent-revoke" :disabled="busy" @click="revoke">Revoke subscription permission</button>
      <button type="button" data-test="image-settings-save" :disabled="busy || !selected?.connected || (mode === 'pinned' && selected?.provider === 'openai' && !pin.trim())" @click="save">{{ busy ? 'Saving…' : 'Save image settings' }}</button>
      <button type="button" :disabled="busy" @click="load">Reload</button>
      <span v-if="saved" role="status">Saved</span>
      <p v-if="selected && !selected.connected">Connect this provider in Settings → API Keys / Connections first.</p>
    </div>
  </section>
</template>
<script setup>
import {ref,computed,onMounted} from 'vue';
import { API_CONFIG } from '@/tt.config.js';
import CustomSelect from '@/views/_components/common/CustomSelect.vue';
const props=defineProps({compact:Boolean});
const open=ref(false),busy=ref(false),error=ref(''),saved=ref(false),connections=ref([]),settings=ref(null),draftConnection=ref(''),mode=ref('latest'),pin=ref(''),allow=ref(false);
const selected=computed(()=>connections.value.find(c=>c.id===draftConnection.value));
const providerOptions=computed(()=>connections.value.map(c=>({label:c.label+(c.connected?'':' · not connected'),value:c.id})));
const modelOptions=[{label:'Latest · Quality',value:'latest'},{label:'Latest · Fast',value:'latest-fast'},{label:'Specific model / snapshot',value:'pinned'}];
async function request(method,body){const token=localStorage.getItem('token');const response=await fetch(API_CONFIG.BASE_URL+'/users/image-settings',{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},credentials:'include',...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(response.status===409?'Settings changed elsewhere. Reload before saving.':data.error||'Image settings unavailable');return data;}
function choose(value){draftConnection.value=typeof value==='object'?value.value:value;saved.value=false;const c=selected.value;const m=settings.value?.options?.[draftConnection.value]?.model;mode.value=['latest','latest-fast'].includes(m)?m:'pinned';pin.value=m||c?.models?.[0]||'';if(c?.provider==='openai'&&!m)mode.value='latest';allow.value=settings.value?.authorizations?.[draftConnection.value]?.allowed===true;}
function setMode(value){mode.value=typeof value==='object'?value.value:value;saved.value=false;}
async function load(){busy.value=true;error.value='';saved.value=false;try{const data=await request('GET');settings.value=data.settings;connections.value=data.connections;choose(data.settings.selectedConnectionId||'');}catch(e){error.value=e.message;}finally{busy.value=false;}}
async function revoke(){busy.value=true;error.value='';saved.value=false;try{const data=await request('PUT',{expectedRevision:settings.value.revision,consent:{connectionId:draftConnection.value,allow:false}});settings.value=data.settings;allow.value=false;saved.value=true;}catch(e){error.value=e.message;}finally{busy.value=false;}}
async function save(){busy.value=true;error.value='';saved.value=false;try{const c=selected.value;const model=c.requiresConsent?'provider-default':c.provider==='openai'?(mode.value==='pinned'?pin.value.trim():mode.value):pin.value;const patch={expectedRevision:settings.value.revision,selectedConnectionId:c.id,options:{connectionId:c.id,value:model?{model}:{}}};if(c.requiresConsent)patch.consent={connectionId:c.id,allow:allow.value};const data=await request('PUT',patch);settings.value=data.settings;saved.value=true;}catch(e){error.value=e.message;}finally{busy.value=false;}}
onMounted(load);
</script>
<style scoped>
.image-settings{font-size:12px;color:var(--color-text);margin:8px 0}.image-settings-panel{padding:14px;border:1px solid var(--terminal-border-color);border-radius:8px;background:var(--color-background)}h3{margin:0 0 8px}p{line-height:1.5;opacity:.85}label{display:block;margin:10px 0 5px}.billing{font-weight:600}button,input{font:inherit;color:inherit;background:transparent;border:1px solid var(--terminal-border-color);border-radius:5px;padding:7px 10px;margin:6px 6px 0 0}button{cursor:pointer}button:disabled{opacity:.5}input[type=checkbox]{margin-right:6px}[role=alert]{color:var(--color-red)}
</style>
