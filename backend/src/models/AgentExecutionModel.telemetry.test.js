import {beforeAll,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import db,{dbReady} from './database/index.js';
import Model from './AgentExecutionModel.js';
import {createExecutionTelemetry,normalizeExecutionTelemetry} from '../services/ai/executionTelemetry.js';
const run=(q,p=[])=>new Promise((r,j)=>db.run(q,p,function(e){e?j(e):r(this.changes)}));
let user;
beforeAll(async()=>{await dbReady;user=randomUUID();await run('INSERT INTO users(id,email,name) VALUES(?,?,?)',[user,user+'@test.local','fixture']);});
it('Given saved measurements When terminal record is read Then exact content-free envelope survives SQLite and trace projection',async()=>{const id=await Model.create(user,null,'fixture',null,'x',null,null);const m=createExecutionTelemetry();m.request([{role:'user',content:'PRIVATE'}],[]);m.toolStarted();m.toolFinished();const t=m.snapshot('failed');await Model.update(id,'failed','',0,1,'failed',null,t);const detail=await Model.getExecutionDetails(id);expect(detail.executionTelemetry).toEqual(t);expect(detail.telemetryAvailability).toBe('available');expect(detail.toolCallsCount).toBe(1);expect(JSON.stringify(detail.executionTelemetry)).not.toContain('PRIVATE');});
it('Given legacy record Then missing telemetry is unavailable not measured zero',async()=>{const id=await Model.create(user,null,'legacy',null,'x',null,null);const d=await Model.getExecutionDetails(id);expect(d.executionTelemetry).toBeNull();expect(d.telemetryAvailability).toBe('unavailable');});
it('Given corrupt stored data Then readback labels invalid and never leaks raw payload',async()=>{const id=await Model.create(user,null,'corrupt',null,'x',null,null);await run('UPDATE agent_executions SET execution_telemetry=? WHERE id=?',['SECRET_CORRUPT',id]);const d=await Model.getExecutionDetails(id);expect(d.telemetryAvailability).toBe('invalid');expect(d.executionTelemetry).toBeNull();});
it('Given malformed telemetry Then reject without overwriting execution',async()=>{const id=await Model.create(user,null,'fixture',null,'x',null,null);await expect(Model.update(id,'completed','',0,0,null,null,{version:999})).rejects.toThrow();expect((await Model.getExecutionDetails(id)).status).toBe('running');});
it('Given untrusted extra fields Then allowlist strips content and executable strings',()=>{const m=createExecutionTelemetry();m.request([{role:'user',content:'secret'}],[]);const t=m.snapshot('completed');t.raw='secret';t.requestMetrics.requests[0].prompt='secret';expect(JSON.stringify(normalizeExecutionTelemetry(t))).not.toContain('secret');});
it('Given invalid counts Then refuse contradictory measurement',()=>{expect(()=>normalizeExecutionTelemetry({version:1,outcome:'failed',toolCalls:{started:1,finished:2,inFlight:0}})).toThrow();});

it('Given partial usage Then absent fields remain null while measured zero remains zero',()=>{const m=createExecutionTelemetry();m.request([{role:'user',content:'x'}],[]);m.usage({input_tokens:0});expect(m.snapshot('failed')).toMatchObject({usage:{inputTokens:0,outputTokens:null,totalTokens:null},usageCoverage:'partial'});});
it('Given measurement expansion Then oversized request history is refused',()=>{expect(()=>normalizeExecutionTelemetry({version:1,outcome:'failed',requestMetrics:{boundary:'adapter_input_json_utf8',requests:Array(1001).fill({})}})).toThrow();});
