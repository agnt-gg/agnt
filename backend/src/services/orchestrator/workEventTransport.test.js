import {it,expect,vi} from 'vitest';
import {createWorkEventTransport} from './workEventTransport.js';
it('replays ordered durable events and advances the cursor only after delivery',async()=>{
 const send=vi.fn(async()=>{});const store={events:vi.fn(async(_id,_owner,cursor)=>cursor<2?[{workId:'work',sequence:1,status:'running'},{workId:'work',sequence:2,status:'paused'}]:[])};
 const transport=createWorkEventTransport({store,work:{id:'work',owner_id:'owner'},send});
 try{transport.start();await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(2));await transport.poll();expect(store.events.mock.calls.at(-1)[2]).toBe(2);}
 finally{await transport.stop();}
});
it('failed delivery is retried without advancing the cursor',async()=>{
 const send=vi.fn().mockRejectedValueOnce(Error('Disconnected')).mockResolvedValue(undefined);
 const onError=vi.fn();const store={events:vi.fn(async()=>[{sequence:1,status:'running',workId:'work'}])};
 const transport=createWorkEventTransport({store,work:{id:'work',owner_id:'owner'},send,onError});
 try{transport.start();await vi.waitFor(()=>expect(onError).toHaveBeenCalledOnce());await transport.poll();expect(store.events.mock.calls[1][2]).toBe(0);}
 finally{await transport.stop();}
});
