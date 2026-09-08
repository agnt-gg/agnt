import { it, expect } from 'vitest';
import fs from 'node:fs';
import { normalizeVoiceMetadata } from './voiceMetadata.js';
it('backend packaged helper stays byte-identical to frontend source',()=>{
 expect(fs.readFileSync(new URL('./voiceMetadata.js',import.meta.url),'utf8')).toBe(fs.readFileSync(new URL('../../../../frontend/src/voice/voiceMetadata.js',import.meta.url),'utf8'));
});
it('server voice metadata remains bounded without upgrading unknown provenance',()=>{
 const input=Array.from({length:10},()=>({type:'voice-input',kind:'bogus',utteranceId:'x'.repeat(500),observedTranscript:'x'.repeat(20000),delegatedInterpretation:'y'.repeat(20000)}));
 const out=normalizeVoiceMetadata(input);expect(out).toHaveLength(8);
 expect(out[0]).toMatchObject({kind:'unknown'});expect(out[0].utteranceId).toHaveLength(256);
 expect(out[0].observedTranscript).toHaveLength(16384);expect(out[0].delegatedInterpretation).toHaveLength(16384);
});
