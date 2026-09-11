import {describe,it,expect} from 'vitest';
import {failureDiagnostic,validatePartialContinuation} from './goalRecoveryEvidence.js';
describe('Given failure diagnostics may contain secrets',()=>{
 it('When a provider error is recorded, Then known credential forms and arbitrary payloads are not retained',()=>{
  const d=failureDiagnostic({message:'Bearer secret-value api_key=secret-two https://x.test/?token=secret-three sk-example-secret',code:'TIMEOUT',stack:'private stack',toolExecutions:[{name:'write_file',status:'failed',arguments:{password:'secret-four'},response:'private response'}]});
  const text=JSON.stringify(d);for(const secret of ['secret-value','secret-two','secret-three','sk-example-secret','secret-four','private stack','private response'])expect(text).not.toContain(secret);
  expect(d.code).toBe('TIMEOUT');expect(d.tools).toEqual([{name:'write_file',status:'failed'}]);
 });
 it('When diagnostics are oversized, Then text and receipt metadata are bounded',()=>{const d=failureDiagnostic({message:'x'.repeat(9000),toolExecutions:Array.from({length:100},()=>({name:'y'.repeat(500)}))});expect(d.message.length).toBe(2000);expect(d.tools).toHaveLength(20);expect(d.tools[0].name.length).toBe(100)});
 it('When evidence only asserts continuation without preserved artifacts, Then the partial gate rejects it',()=>expect(()=>validatePartialContinuation({workerStopped:true,effectsReconciled:true,attemptId:'a',remainingWork:'continue',doNotRepeat:['preserve'],artifacts:[]})).toThrow());
});
