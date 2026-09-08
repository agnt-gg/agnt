import {ref,computed,onUnmounted} from 'vue';
import {createCodexVoiceController} from '../voice/codexVoiceController.js';
import {codexVoiceSettings,codexVoiceProfiles} from '../voice/codexVoiceSettings.js';
import {API_CONFIG} from '../../user.config.js';
import {voiceErrorMessage} from '../voice/voiceErrorMessage.js';
export function useCodexVoice({submitTurn}={}){
 const state=ref('idle'),error=ref(null),partial=ref(''),listening=ref(true);
 const controller=createCodexVoiceController({apiBase:API_CONFIG.BASE_URL,getToken:()=>localStorage.getItem('token'),submitTurn,onState:s=>state.value=s,onError:code=>error.value=voiceErrorMessage(code),onTranscript:event=>{partial.value=event.text;}});
 const stopForIdentity=()=>{controller.stop();partial.value='';error.value=null;listening.value=true;};
 const releaseIdentity=codexVoiceProfiles.onScopeChange(stopForIdentity);
 onUnmounted(()=>{releaseIdentity();controller.stop();});
 return {state,error,partial,listening,isActive:computed(()=>state.value!=='idle'),start:()=>{error.value=null;if(!codexVoiceProfiles.identity.ready){error.value='Sign in to this AGNT installation before starting voice.';return false;}listening.value=true;return controller.start({...codexVoiceSettings});},stop:()=>controller.stop(),stopPlayback:()=>controller.stopPlayback(),toggleListening:()=>{listening.value=!listening.value;controller.setListening(listening.value);}};
}
