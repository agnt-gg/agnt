import { it, expect, vi } from 'vitest';
import { createWorkStreamHub } from './workStreamHub.js';
it('does not end the HTTP stream when a model segment ends',async()=>{
 const transport={start:vi.fn(),send:vi.fn(),finish:vi.fn()};
 const hub=createWorkStreamHub({store:{events:async()=>[]}});
 try{
  const work={id:'work',owner_id:'owner',conversation_id:'chat'};
  await hub.attach(work,transport);
  const segment=await hub.forWork(work);
  segment.send('content_delta',{delta:'More work'});segment.send('done',{});segment.finish();
  expect(transport.finish).not.toHaveBeenCalled();
  expect(transport.send.mock.calls.some(([name])=>name==='done')).toBe(false);
 }finally{await hub.close();}
});
it('finishes only after a persisted terminal work event',async()=>{
 const transport={start:vi.fn(),send:vi.fn(),finish:vi.fn()};
 const hub=createWorkStreamHub({store:{events:async()=>[{workId:'work',sequence:1,status:'succeeded'}]}});
 try{
  await hub.attach({id:'work',owner_id:'owner',conversation_id:'chat'},transport);
  await vi.waitFor(()=>expect(transport.finish).toHaveBeenCalledOnce());
  expect(transport.send.mock.calls.map(([name])=>name)).toEqual(['conversation_started','work_state_changed','done']);
 }finally{await hub.close();}
});
