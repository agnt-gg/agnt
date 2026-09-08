import {it,expect} from 'vitest';
import {parseCodexEvent} from './codexVoiceProtocol.js';
it('retains exact native assistant creation identity even when native playback is disabled',()=>{
 expect(parseCodexEvent(JSON.stringify({type:'turn.created',turn:{id:'assistant-19',role:'assistant'}}))).toMatchObject({type:'assistant-turn-start',id:'assistant-19'});
});
