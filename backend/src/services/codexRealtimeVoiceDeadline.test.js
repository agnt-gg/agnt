import {it,expect,vi} from 'vitest';
import {createCodexVoiceCall} from './codexRealtimeVoiceService.js';
it('stalled credential lookup times out without provider request',async()=>{const fetchImpl=vi.fn();const getEntry=()=>({config:{key:'openai-codex',authScheme:'codex'},manager:{ensureValidOAuthToken:()=>new Promise(()=>{})}});await expect(createCodexVoiceCall({sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'},{getEntry,fetchImpl,timeoutMs:15})).rejects.toThrow('voice_setup_timeout');expect(fetchImpl).not.toHaveBeenCalled();});
