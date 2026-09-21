import {it,expect} from 'vitest';
import {restoreSegmentHistory} from './segmentHistory.js';
const prefix={role:'system',content:'Frozen prefix\n\nMemory and tools'};
it('preserves exact prefix bytes across scheduling boundaries',()=>{
 const messages=[prefix,{role:'user',content:'Finish Teams'},{role:'assistant',content:'Four requirements remain.'}];
 const checkpoint={conversationId:'chat',messages};
 const resumed=restoreSegmentHistory({conversationId:'chat',checkpoint,continuation:'Continue unmet requirements.'});
 expect(JSON.stringify(resumed.slice(0,messages.length))).toBe(JSON.stringify(messages));
 expect(resumed).toHaveLength(4);expect(checkpoint.messages).toHaveLength(3);
});
it('folds into the tool_result instead of appending the Anthropic anti-pattern',()=>{
 // A budget-exhausted segment ends exactly like this. Appending a user turn
 // here is what broke Anthropic/Claude Code.
 const messages=[prefix,{role:'assistant',content:[{type:'tool_use',id:'call-1',name:'write_file',input:{}}]},
  {role:'user',content:[{type:'tool_result',tool_use_id:'call-1',content:'written'}]}];
 const resumed=restoreSegmentHistory({conversationId:'chat',checkpoint:{conversationId:'chat',messages},continuation:'Two files remain.'});
 expect(resumed).toHaveLength(3);
 expect(resumed.at(-1).role).toBe('user');
 expect(resumed.at(-1).content.every(block=>block.type==='tool_result')).toBe(true);
 expect(JSON.stringify(resumed.at(-1))).toContain('Two files remain.');
});
it('still appends a real user turn to an OpenAI-style tool history',()=>{
 const messages=[prefix,{role:'assistant',content:null,tool_calls:[{id:'call-1'}]},{role:'tool',tool_call_id:'call-1',content:'written'}];
 const resumed=restoreSegmentHistory({conversationId:'chat',checkpoint:{conversationId:'chat',messages},continuation:'Two files remain.'});
 expect(resumed).toHaveLength(4);expect(resumed.at(-1)).toEqual({role:'user',content:'Two files remain.'});
});
it('rejects cross-conversation resume',()=>expect(()=>restoreSegmentHistory({conversationId:'other',checkpoint:{conversationId:'chat',messages:[]}})).toThrow());
it('rejects absent prefix instead of quietly rebuilding it',()=>expect(()=>restoreSegmentHistory({conversationId:'chat',checkpoint:{conversationId:'chat',messages:[{role:'user',content:'hello'}]}})).toThrow());
