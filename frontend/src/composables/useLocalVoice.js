import { ref, computed, onUnmounted } from 'vue';
import { createLocalVoiceController } from '../voice/localVoiceController.js';
import { codexVoiceProfiles, codexVoiceSettings } from '../voice/codexVoiceSettings.js';
import { API_CONFIG } from '../../user.config.js';
export function useLocalVoice({submitTurn} = {}) {
 const state = ref('idle'), listening = ref(false), partial = ref(''), error = ref(null);
 const controller = createLocalVoiceController({apiBase:API_CONFIG.BASE_URL,getToken:()=>localStorage.getItem('token'),submitTurn,
  onState:s=>state.value=s,onListening:v=>listening.value=v,onTranscript:e=>partial.value=e.text,
  onError:()=>error.value='Local voice could not confirm this operation. No audio-provider fallback was used. Check local service access or resume the mic to retry; inspect chat before repeating a task.'});
 const stop = () => {controller.stop();partial.value='';error.value=null;};
 const release = codexVoiceProfiles.onScopeChange(stop);
 onUnmounted(()=>{release();stop();});
 return {state,listening,partial,error,isActive:computed(()=>state.value!=='idle'),start:()=>{
  error.value=null;if(!codexVoiceProfiles.identity.ready){error.value='Sign in to this AGNT installation before starting voice.';return false;}
  return controller.start({output:codexVoiceSettings.output || 'webspeech',providerEngine:codexVoiceSettings.providerEngine});
 },stop,commit:()=>controller.commit(),stopPlayback:()=>controller.stopPlayback(),toggleListening:()=>controller.setListening(!listening.value)};
}
