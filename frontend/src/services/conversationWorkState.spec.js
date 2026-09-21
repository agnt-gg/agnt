import {it,expect} from 'vitest';
import {reduceConversationWork} from './conversationWorkState.js';
it('keeps a queued objective active between streamed messages',()=>expect(reduceConversationWork(null,{workId:'one',sequence:1,status:'queued'}).active).toBe(true));
it('ignores an old running event after Stop',()=>{
 const stopped=reduceConversationWork(null,{workId:'one',sequence:5,status:'paused'});
 expect(reduceConversationWork(stopped,{workId:'one',sequence:4,status:'running'})).toBe(stopped);
});
it('requires explicit objective replacement for a different work identity',()=>{
 const current=reduceConversationWork(null,{workId:'one',sequence:1,status:'running'});
 expect(reduceConversationWork(current,{workId:'two',sequence:2,status:'running'})).toBe(current);
 expect(reduceConversationWork(current,{workId:'two',sequence:2,status:'running',newObjective:true}).workId).toBe('two');
});
it('rejects malformed status',()=>expect(reduceConversationWork(null,{workId:'one',sequence:1,status:'whatever'})).toBeNull());
