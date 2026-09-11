import {expect,it} from 'vitest';
import {processReturnedReceipts} from './runAgentResult.js';
const measured={toolCalls:{finished:1,inFlight:0}};
it('Native scanner redacts nested returned JSON and drops auth channels before scanning',()=>{
 const secret='sk-'+ 'testsecret'.repeat(4);
 const r=processReturnedReceipts([{name:'fixture',arguments:{authToken:'opaque-value',body:secret},response:JSON.stringify({body:secret,ok:true})}],measured);
 const text=JSON.stringify(r);expect(text).not.toContain(secret);expect(text).not.toContain('opaque-value');expect(text).toContain('REDACTED');expect(r.receipts[0].output.ok).toBe(true);expect(r.receipts[0].callId).toBeNull();expect(r.completeness).toBe('partial_or_unknown');
});
it('Scanner bypass-size/base64 payloads and bounded expansion are omitted, not truncated into secrets',()=>{
 const r=processReturnedReceipts([{name:'fixture',arguments:{},response:'A'.repeat(70000)}],measured);
 expect(JSON.stringify(r).length).toBeLessThan(1000);expect(r.completeness).toBe('partial_or_unknown');expect(r.receipts[0].output).toContain('omitted');
 const many=processReturnedReceipts(Array(60).fill({name:'fixture',arguments:{},response:'ok'}),{toolCalls:{finished:60,inFlight:0}});expect(many.receipts).toHaveLength(50);expect(many.completeness).toBe('partial_or_unknown');
});
it('Missing and cyclic payloads cannot claim complete evidence',()=>{const x={};x.self=x;expect(processReturnedReceipts(undefined,measured).completeness).toBe('partial_or_unknown');expect(processReturnedReceipts([{name:'fixture',arguments:x,response:'ok'}],measured).completeness).toBe('partial_or_unknown');});
