<template>
 <section class="voice-config" aria-labelledby="voice-profile-heading">
  <h3 id="voice-profile-heading">Voice backend</h3>
  <p>Annie's reasoning model stays unchanged. Native Codex voice is an opt-in preview for panel and workspace chats.</p>
  <div class="voice-control"><span>Audio engine</span><CustomSelect aria-label="Audio engine" :model-value="settings.engine" :options="engineOptions" :disabled="!identity.ready" @update:model-value="selectSetting('engine', $event)" /></div>
  <p v-if="!identity.ready" role="status">Sign in to this AGNT installation to configure voice.</p>
  <p>Saved only for your signed-in AGNT user, this backend, and this browser. Shared legacy preferences are not imported.</p>
  <template v-if="settings.engine === 'local'">
   <p role="status">Local ASR requires administrator opt-in and access for your user. No service or account fallback. Record a complete instruction, then press Send voice utterance; pauses never submit. Capture stops after Send. Resume mic starts a new utterance; Pause mic discards unsent audio. Maximum 60 seconds; overlong utterances are rejected, never truncated and submitted.</p>
   <p>Text reasoning uses your selected chat model. Browser output may use your OS speech service. Local PCM output is an explicit, unqualified candidate and fails closed if unavailable; canonical TTS is not replaced. Stop playback and Pause mic do not cancel an accepted task. Human acoustics remain unverified.</p>
  </template>
  <template v-if="settings.engine === 'codex'">
   <div class="voice-control"><span>Existing provider account</span><CustomSelect aria-label="Existing provider account" :model-value="settings.provider" :options="providerOptions" :disabled="!identity.ready" @update:model-value="selectSetting('provider', $event)" /></div>
   <div class="voice-control"><span>Native input-session voice (not the final-text TTS voice)</span><CustomSelect aria-label="Native input-session voice" :model-value="settings.voice" :options="voiceOptions" :disabled="!identity.ready || catalog[settings.provider]?.registered !== true" @update:model-value="selectSetting('voice', $event)" /></div>
   <p role="status">{{ status }}</p>
   <p>No account or metered API fallback. Raw audio goes to the selected Codex voice service. Changing settings ends the active voice session. Model changes and overlapping voice commands are not yet supported in this preview. Output is explicit final-text TTS through the selected output below; native generative audio stays unconditionally muted. This does not enable realtime Codex voice narration. Narration waits for confirmed task completion and reads the answer's opening paragraph, not its screen-only detail. Browser/OS voice availability and pronunciation vary. Stop playback and Pause mic do not cancel an accepted task; use the chat's task-stop control for that. Local interruption timing and real-device acoustics remain under qualification.</p>
   <button type="button" :disabled="!identity.ready" v-tooltip="'Checks provider registration only; does not start a voice session or verify entitlement.'" @click="refresh">Check registration (not a paid call)</button>
  </template>
  <template v-if="settings.engine === 'local' || settings.engine === 'codex'">
   <div class="voice-control"><span>Final-text output</span><CustomSelect aria-label="Local voice output" :model-value="settings.output || 'webspeech'" :options="outputOptions" :disabled="!identity.ready" @update:model-value="selectSetting('output', $event)" /></div>
   <div class="voice-control"><span>Server-configured PCM candidate</span><CustomSelect aria-label="Local stream provider" :model-value="settings.providerEngine || ''" :options="streamOptions" :disabled="!identity.ready" @update:model-value="selectSetting('providerEngine', $event)" /></div>
   <p>No PCM candidate is selected by default. Choose the exact administrator-configured engine before enabling local streaming. Pocket CPU is an explicit availability alternative, not faster-Qwen qualification or automatic fallback. An unavailable or mismatched server fails closed; no cloud TTS is used by local streaming.</p>
  </template>
 </section>
</template>
<script setup>
import { ref, reactive, computed, watch, onUnmounted } from 'vue';
import { codexVoiceSettings as settings, codexVoiceProfiles, saveCodexVoiceSettings } from '../voice/codexVoiceSettings.js';
import { CODEX_VOICES, CODEX_VOICE_PROVIDERS as providers } from '../voice/codexVoiceConfig.js';
import { API_CONFIG } from '../../user.config.js';
import CustomSelect from '../views/_components/common/CustomSelect.vue';
const identity = codexVoiceProfiles.identity;
const catalog = reactive({});
const saveError = ref('');
const voices = computed(() => catalog[settings.provider]?.voices || CODEX_VOICES);
const engineOptions = [
  { value: 'legacy', label: 'Existing voice behavior' },
  { value: 'codex', label: 'OpenAI Codex native voice · preview' },
  { value: 'local', label: 'Local ASR · explicit-send preview' },
];
const streamOptions = [{value:'',label:'No candidate selected',disabled:true},{value:'pocket-tts-cpu',label:'Pocket TTS · CPU · server opt-in'},{value:'faster-qwen-candidate',label:'faster-Qwen · candidate · owner admission required'}];
const outputOptions = computed(() => [{value:'webspeech',label:'Browser final-text narration'}, {value:'local-stream',label:'Local PCM streaming · unqualified candidate',disabled:!settings.providerEngine}]);
const providerOptions = computed(() => providers.map(provider => ({
  value: provider,
  label: `${provider === 'openai-codex-2' ? 'OpenAI Codex · Account 2' : 'OpenAI Codex'} · ${accountLabel(provider)}`,
  disabled: catalog[provider]?.registered !== true,
})));
const voiceOptions = computed(() => voices.value.map(voice => ({ value: voice, label: voice })));
let revision = 0;
let request = null;
let requestTimer = null;
const accountLabel = provider => catalog[provider]?.registered === true ? 'registered, entitlement unverified' : catalog[provider]?.registered === false ? 'not registered' : 'unverified';
const status = computed(() => {
  if (saveError.value) return saveError.value;
  const selected = catalog[settings.provider];
  if (selected?.failed) return 'Registration check failed. No fallback will be used.';
  if (selected?.registered === false) return 'This account is not registered for voice in this build. No other account will be used.';
  if (selected?.registered === true) return 'Provider registered. Voice access remains unverified until a session connects.';
  return 'Voice registration and entitlement have not been verified.';
});
function selectSetting(key, value) {
  if (!identity.ready) return;
  const options = key === 'engine' ? engineOptions : key === 'provider' ? providerOptions.value : key === 'voice' ? voiceOptions.value : key === 'output' ? outputOptions.value : key === 'providerEngine' ? streamOptions : [];
  if (!options.some(option => option.value === value && !option.disabled)) return;
  if (['output','providerEngine'].includes(key) && !['local','codex'].includes(settings.engine)) return;
  if (!['engine', 'output', 'providerEngine'].includes(key) && settings.engine !== 'codex') return;
  if (key === 'voice' && catalog[settings.provider]?.registered !== true) return;
  settings[key] = value;
  saveError.value = saveCodexVoiceSettings() ? '' : 'Could not persist valid voice settings for this user.';
}
function invalidate() {
  revision++;
  request?.abort();
  request = null;
  clearTimeout(requestTimer);
  requestTimer = null;
  for (const provider of providers) delete catalog[provider];
  saveError.value = '';
}
async function refresh() {
  invalidate();
  if (!identity.ready || settings.engine !== 'codex') return;
  const current = revision;
  const controller = new AbortController();
  request = controller;
  const timer = setTimeout(() => controller.abort(), 5000);
  requestTimer = timer;
  try {
    await Promise.all(providers.map(async provider => {
      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}/speech/codex/capabilities?provider=${encodeURIComponent(provider)}`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }, signal: controller.signal,
        });
        if (!response.ok) throw new Error('catalog unavailable');
        // Registration is small bounded metadata, never provider credentials.
        const reader = response.body.getReader();
        let size = 0, raw = '';
        const decoder = new TextDecoder();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 8192) throw new Error('catalog oversized');
            raw += decoder.decode(value, { stream: true });
          }
          raw += decoder.decode();
        } catch (error) { await reader.cancel(); throw error; } finally { reader.releaseLock(); }
        const data = JSON.parse(raw);
        if (data.provider !== provider || typeof data.registered !== 'boolean' || data.fallback !== 'none') throw new Error('catalog identity mismatch');
        if (data.registered && (!Array.isArray(data.voices) || !data.voices.length || data.voices.length > CODEX_VOICES.length || data.voices.some(voice => !CODEX_VOICES.includes(voice)))) throw new Error('invalid voice catalog');
        if (current === revision && !controller.signal.aborted) catalog[provider] = { registered: data.registered, voices: data.voices };
      } catch {
        if (current === revision) catalog[provider] = { failed: true };
      }
    }));
  } finally {
    clearTimeout(timer);
    if (request === controller) { request = null; requestTimer = null; }
  }
}
// Synchronous invalidation prevents a stale reply from crossing an account change.
const releaseIdentity = codexVoiceProfiles.onScopeChange(invalidate);
watch(() => [identity.ready, identity.revision, settings.engine], refresh, { immediate: true });
onUnmounted(() => { releaseIdentity(); invalidate(); });
</script>
<style scoped>
.voice-config { border: 1px solid var(--terminal-border-color); border-radius: 8px; padding: 20px; width: 100%; box-sizing: border-box; color: var(--color-text); }
.voice-config p { line-height: 1.5; font-size: 13px; color: var(--color-text-muted); }
.voice-control { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin: 12px 0; }
.voice-control > span { flex: 1 1 190px; }
.voice-control :deep(.custom-select) { flex: 1 1 260px; min-width: 0; max-width: 100%; }
.voice-config button { padding: 8px; background: var(--color-darker-0); color: var(--color-text); border: 1px solid var(--terminal-border-color); border-radius: 5px; cursor: pointer; }
.voice-config button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.voice-config button:disabled { opacity: .5; cursor: not-allowed; }
</style>
