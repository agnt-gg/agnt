import {it,expect} from 'vitest';
import {applyStreamEvent} from './chatStreamReducer.js';
it('closing a segment does not clear active work',()=>{
 const message={};applyStreamEvent(message,'work_state_changed',{workId:'work',sequence:1,status:'queued'});
 expect(applyStreamEvent(message,'done').status).toBe('Working…');
});
it('stale replay cannot undo paused state',()=>{
 const message={};applyStreamEvent(message,'work_state_changed',{workId:'work',sequence:2,status:'paused'});
 expect(applyStreamEvent(message,'work_state_changed',{workId:'work',sequence:1,status:'running'}).changed).toBe(false);
 expect(message.workState.status).toBe('paused');
});
