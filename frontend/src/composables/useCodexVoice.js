import {ref,computed,onUnmounted} from 'vue';
import {createCodexVoiceController} from '../voice/codexVoiceController.js';
import {codexVoiceSettings} from '../voice/codexVoiceSettings.js';
import {API_CONFIG} from '../../user.config.js';
export function useCodexVoice({submitTurn}={}){
 const state=ref('idle'),error=ref(null),partial=ref('');
 const controller=createCodexVoiceController({apiBase:API_CONFIG.BASE_URL,getToken:()=>localStorage.getItem('token'),submitTurn,onState:s=>state.value=s,onError:code=>error.value=code,onTranscript:event=>{partial.value=event.text;}});
 onUnmounted(()=>controller.stop());
 return {state,error,partial,isActive:computed(()=>state.value!=='idle'),start:()=>{error.value=null;return controller.start(codexVoiceSettings);},stop:()=>controller.stop()};
}
