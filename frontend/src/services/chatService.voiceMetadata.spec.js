import {it,expect,vi,afterEach} from 'vitest';
import {streamChat} from './chatService.js';
import {nativeVoiceMetadata} from '../voice/nativeVoiceSubmit.js';
afterEach(()=>vi.unstubAllGlobals());
it('a subsequent typed request has no stale voice provenance',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,body:{getReader:()=>({read:async()=>({done:true})})}})));
 await streamChat({chatType:'agent',messages:[{role:'user',content:'spoken'}],voiceMetadata:metadata,onEvent:vi.fn()});
 await streamChat({chatType:'agent',messages:[{role:'user',content:'typed'}],onEvent:vi.fn()});
 expect(JSON.parse(fetch.mock.calls[1][1].body).voiceMetadata).toBeUndefined();
});
const metadata=nativeVoiceMetadata({commitKind:'correlated-delegation',utteranceId:'TEST-current',transcript:'Move the file',delegatedInterpretation:'Move the file only after backup.'});
it.each([false,true])('unified transport carries separate current-turn provenance, multipart=%s',async multipart=>{
 vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,body:{getReader:()=>({read:async()=>({done:true})})}})));
 await streamChat({chatType:'agent',messages:[{role:'user',content:'Move the file only after backup.'}],provider:'selected',model:'selected-model',voiceMetadata:metadata,onEvent:vi.fn(),files:multipart?[new File(['text'],'test.txt')]:[]});
 const raw=fetch.mock.calls[0][1].body;
 const body=multipart?Object.fromEntries(raw.entries()):JSON.parse(raw);
 expect(multipart?JSON.parse(body.voiceMetadata):body.voiceMetadata).toEqual(metadata);
 expect(body.provider).toBe('selected');expect(body.model).toBe('selected-model');
 expect(JSON.stringify(body.messages)).not.toContain('observedTranscript');
});
