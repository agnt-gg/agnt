import {it,expect} from 'vitest';
import {restoreSegmentHistory} from './segmentHistory.js';
it('preserves exact prefix bytes across scheduling boundaries',()=>{
 const messages=[{role:'system',content:'Frozen prefix\n\nMemory and tools'},{role:'user',content:'Finish Teams'},{role:'assistant',content:'Four requirements remain.'}];
 const checkpoint={conversationId:'chat',messages};
 const resumed=restoreSegmentHistory({conversationId:'chat',checkpoint,continuation:'Continue unmet requirements.'});
 expect(JSON.stringify(resumed.slice(0,messages.length))).toBe(JSON.stringify(messages));
 expect(resumed).toHaveLength(4);expect(checkpoint.messages).toHaveLength(3);
});
it('rejects cross-conversation resume',()=>expect(()=>restoreSegmentHistory({conversationId:'other',checkpoint:{conversationId:'chat',messages:[]}})).toThrow());
it('rejects absent prefix instead of quietly rebuilding it',()=>expect(()=>restoreSegmentHistory({conversationId:'chat',checkpoint:{conversationId:'chat',messages:[{role:'user',content:'hello'}]}})).toThrow());
