import { describe, it, expect } from 'vitest';
import { applyStreamEvent, hydrateMessage } from './chatStreamReducer.js';
import { toStoredMessage } from './conversationTranscript.js';
describe('authoritative answer seal',()=>{
 for(const restore of [false,true]) it(`rejects late deltas and conflicting finals (restored=${restore})`,()=>{
  let m={id:'m',role:'assistant',content:'',contentParts:[]};
  applyStreamEvent(m,'content_delta',{delta:'Yes, do it.'});
  applyStreamEvent(m,'final_content',{content:'No.'});
  applyStreamEvent(m,'done',{});
  if(restore)m=hydrateMessage(toStoredMessage(m));
  applyStreamEvent(m,'content_delta',{delta:' Actually, do it.'});
  applyStreamEvent(m,'final_content',{content:'Yes.'});
  expect(m.content).toBe('No.');expect(m.contentParts.filter(p=>p.type==='text').map(p=>p.text).join('')).toBe('No.');
  expect(m.streamFinalized).toBe(true);expect(m.streamTerminal).toBe(true);
 });
 it('done without final still closes the message to late text',()=>{const m={content:'draft'};applyStreamEvent(m,'done');applyStreamEvent(m,'content_delta',{delta:'late'});expect(m.content).toBe('draft');});
});
