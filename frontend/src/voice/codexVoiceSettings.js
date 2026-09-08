import {reactive} from 'vue';
const key='agnt.voice.profile.v1';
const defaults={engine:'legacy',provider:'openai-codex',voice:'cove'};
let initial={...defaults};try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&['legacy','codex'].includes(saved.engine)&&['openai-codex','openai-codex-2'].includes(saved.provider))initial={...defaults,...saved};}catch{/* storage optional */}
export const codexVoiceSettings=reactive(initial);
export function saveCodexVoiceSettings(){try{localStorage.setItem(key,JSON.stringify({engine:codexVoiceSettings.engine,provider:codexVoiceSettings.provider,voice:codexVoiceSettings.voice}));return true;}catch{return false;}}
