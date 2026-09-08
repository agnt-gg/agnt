<template>
 <section class="voice-config" aria-labelledby="voice-profile-heading">
  <h3 id="voice-profile-heading">Voice backend</h3>
  <p>Annie's reasoning model stays unchanged. Native Codex voice is an opt-in preview for panel and workspace chats.</p>
  <label>Audio engine <select v-model="settings.engine" @change="save"><option value="legacy">Existing voice behavior</option><option value="codex">OpenAI Codex native voice · preview</option></select></label>
  <template v-if="settings.engine === 'codex'">
   <label>Existing provider account <select v-model="settings.provider" @change="refresh"><option value="openai-codex">OpenAI Codex</option><option value="openai-codex-2">OpenAI Codex · Account 2 (if registered)</option></select></label>
   <label>Voice <select v-model="settings.voice" @change="save"><option v-for="voice in voices" :key="voice" :value="voice">{{ voice }}</option></select></label>
   <p role="status">{{ status }}</p>
   <p>No account or metered API fallback. Raw audio goes to the selected Codex voice service. Changing settings ends the active voice session. Model changes and overlapping voice commands are not yet supported in this preview. Voice may paraphrase; exact wording is not guaranteed. Interruption responsiveness is still under qualification.</p>
   <button type="button" @click="refresh">Check registration (not a paid call)</button>
  </template>
 </section>
</template>
<script setup>
import {ref,onMounted} from 'vue';
import {codexVoiceSettings as settings,saveCodexVoiceSettings} from '../voice/codexVoiceSettings.js';
import {API_CONFIG} from '../../user.config.js';
const voices=['juniper','maple','spruce','ember','vale','breeze','arbor','sol','cove'];
const status=ref('Voice entitlement has not been tested.');
let revision=0;
function save(){if(!saveCodexVoiceSettings())status.value='Could not persist voice settings.';}
async function refresh(){save();const current=++revision;try{const r=await fetch(`${API_CONFIG.BASE_URL}/speech/codex/capabilities?provider=${encodeURIComponent(settings.provider)}`,{headers:{Authorization:`Bearer ${localStorage.getItem('token')}`}});if(!r.ok)throw new Error();const d=await r.json();if(current!==revision)return;status.value=d.registered?'Provider registered. Voice access remains unverified until a session connects.':'This account is not registered for voice in this build. No other account will be used.';}catch{if(current===revision)status.value='Registration check failed. No fallback will be used.';}}
onMounted(()=>{if(settings.engine==='codex')refresh();});
</script>
<style scoped>
.voice-config{border:1px solid var(--terminal-border-color,#555);border-radius:8px;padding:20px;width:100%;box-sizing:border-box;color:var(--color-text,#ddd)}
.voice-config p{line-height:1.5;font-size:13px;opacity:.85}.voice-config label{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin:12px 0}.voice-config select,.voice-config button{padding:8px;background:var(--color-background,#222);color:inherit;border:1px solid var(--terminal-border-color,#666);border-radius:5px}
</style>
