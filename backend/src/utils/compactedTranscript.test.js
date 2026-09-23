import { it, expect } from 'vitest';
import { reconcileCompactedTranscript, WIRE_PREAMBLE, WIRE_ACK } from './compactedTranscript.js';
const marker={role:'compaction',content:'Summary'}, originals=[{role:'user',content:'original'},marker];
const prefix=[{role:'user',content:`${WIRE_PREAMBLE}\n\nSummary`},{role:'assistant',content:WIRE_ACK}];
it('passes ordinary transcripts through unchanged',()=>{const incoming=[{role:'user',content:'hello'}];expect(reconcileCompactedTranscript([],incoming)).toBe(incoming);});
it('restores only the saved prefix and never stores synthetic acknowledgements',()=>{const tail=[{role:'user',content:'next'},{role:'assistant',content:'done'}];expect(reconcileCompactedTranscript([...originals,tail[0]],[...prefix,...tail])).toEqual([...originals,...tail]);});
it('refuses a projection for another or edited summary',()=>{expect(reconcileCompactedTranscript(originals,[{...prefix[0],content:'other'},prefix[1]])).toBeNull();});
it('refuses projections that drop already-saved tail user turns',()=>{expect(reconcileCompactedTranscript([...originals,{role:'user',content:'keep'}],prefix)).toBeNull();});
