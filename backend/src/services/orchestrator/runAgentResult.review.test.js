import {it,expect} from 'vitest';
import {readReturnedReceipts,processReturnedReceipts} from './runAgentResult.js';
const envelope=receipts=>JSON.stringify({version:1,policy:'bounded-enforce-v1',completeness:'returned_set_complete',rowCoverage:'returned_set_complete',contentDisposition:'unchanged',receipts});
it('Readback cannot retain complete after malformed receipt is removed',()=>{const r=readReturnedReceipts(envelope([{availability:'malformed'}]));expect(r.value?.completeness).not.toBe('returned_set_complete');});
it('Readback cannot retain complete after large output is omitted',()=>{const r=readReturnedReceipts(envelope([{name:'fixture',callId:null,input:{},output:'x'.repeat(9000)}]));expect(r.value.completeness).toBe('partial_or_unknown');});
it('Scanner-only content transformation is distinct from returned row coverage',()=>{const r=processReturnedReceipts([{name:'fixture',arguments:{},response:{body:'sk-'+ 'testsecret'.repeat(4)}}],{toolCalls:{finished:1,inFlight:0}});expect(r.rowCoverage).toBe('returned_set_complete');expect(r.contentDisposition).toBe('transformed');expect(r.completeness).toBe('partial_or_unknown');});

it('Contradictory stored metadata cannot claim complete',()=>{const r=readReturnedReceipts(JSON.stringify({version:1,policy:'bounded-enforce-v1',completeness:'returned_set_complete',rowCoverage:'partial_or_unknown',contentDisposition:'omitted',receipts:[]}));expect(r.value?.completeness).not.toBe('returned_set_complete');});

it('Clean complete receipt remains complete on readback',()=>{const r=readReturnedReceipts(envelope([{name:'fixture',callId:'c',input:{},output:{ok:true}}]));expect(r.value.completeness).toBe('returned_set_complete');expect(r.value.contentDisposition).toBe('unchanged');});
it.each([{rowCoverage:'partial_or_unknown'},{contentDisposition:'omitted'},{contentDisposition:'transformed'}])('Single contradictory field %j prevents complete',patch=>{const r=readReturnedReceipts(JSON.stringify({...JSON.parse(envelope([])),...patch}));expect(r.value.completeness).toBe('partial_or_unknown');});
it('Legacy missing content disposition remains unknown',()=>{const old=JSON.parse(envelope([]));delete old.contentDisposition;const r=readReturnedReceipts(JSON.stringify(old));expect(r.value.contentDisposition).toBe('unknown');expect(r.value.completeness).toBe('partial_or_unknown');});
