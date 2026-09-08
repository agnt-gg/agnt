import {it,expect,vi} from 'vitest';
import {bindVoiceRequestOrigin,verifiedVoiceUser} from './voiceRequestOrigin.js';
it('reads only a verified session user, never a token or fallback account',()=>{
 expect(verifiedVoiceUser({userAuth:{sessionState:'valid',user:{id:'u'}}})).toBe('u');
 for(const sessionState of ['unknown','invalid','loading',undefined])expect(verifiedVoiceUser({userAuth:{sessionState,user:{id:'u'}}})).toBeUndefined();
});
it('typed transports create no nonce and do not bind',()=>{
 const uuid=vi.fn();expect(bindVoiceRequestOrigin(null,{},uuid)).toBeNull();expect(uuid).not.toHaveBeenCalled();
});
it('new conversation omits temporary ID; each real dispatch receives a fresh nonce',()=>{
 const bind=vi.fn(),uuid=vi.fn().mockReturnValueOnce('r1').mockReturnValueOnce('r2');
 const identity={userId:'u',provider:'SELECTED',model:'model',conversationId:'temp-new'};
 expect(bindVoiceRequestOrigin(bind,identity,uuid)).toBe('r1');expect(bind.mock.calls[0][0]).toEqual({userId:'u',requestId:'r1',provider:'selected',model:'model'});
 expect(bindVoiceRequestOrigin(bind,{...identity,conversationId:'c'},uuid)).toBe('r2');expect(bind.mock.calls[1][0].conversationId).toBe('c');
});
