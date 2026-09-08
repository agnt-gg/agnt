import { it, expect } from 'vitest';
import { canAdoptCompletedTranscript as adopt } from './transcriptAuthority.js';
const u={id:'u',role:'user',content:'May I proceed?'};
const local=[u,{id:'a',role:'assistant',content:'Yes, proceed without hesitation.'}];
const remote={conversationId:'c',status:'completed',executionId:'e',revision:2,messages:[u,{id:'a',role:'assistant',content:'No.'}]};
it('accepts shorter and explicit empty authoritative answers',()=>{
 expect(adopt(remote,local,'c',1)).toBe(true);
 expect(adopt({...remote,messages:[u,{id:'a',role:'assistant',content:''}]},local,'c',1)).toBe(true);
});
it('rejects wrong conversation, old revision, unknown terminal and later local question',()=>{
 expect(adopt(remote,local,'wrong')).toBe(false);
 expect(adopt(remote,local,'c',3)).toBe(false);
 expect(adopt({...remote,status:'unknown'},local,'c')).toBe(false);
 expect(adopt(remote,[...local,{id:'u2',role:'user',content:'And now?'}],'c')).toBe(false);
});
it('does not let length authorize uncompleted or uncorrelated text',()=>{
 expect(adopt({...remote,executionId:''},local,'c')).toBe(false);
 expect(adopt({...remote,messages:[{...u,id:'different'},{id:'a',role:'assistant',content:'Yes.'.repeat(200)}]},local,'c')).toBe(false);
});
