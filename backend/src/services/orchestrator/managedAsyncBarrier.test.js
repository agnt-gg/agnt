import {it,expect,vi} from 'vitest';
import {createManagedAsyncBarrier} from './managedAsyncBarrier.js';
it('waits for completion instead of ending the lease at enqueue',async()=>{
 let status='running';const queue={getExecution:()=>({status}),cancel:vi.fn()};
 const barrier=createManagedAsyncBarrier({queue,intervalMs:1});barrier.track('job');
 let ended=false;const promise=barrier.settle().then(()=>{ended=true;});
 await new Promise(resolve=>setTimeout(resolve,5));expect(ended).toBe(false);
 status='completed';await promise;expect(ended).toBe(true);
});
it('Stop cancels queued executions',async()=>{
 const controller=new AbortController();const queue={getExecution:()=>({status:'running'}),cancel:vi.fn()};
 const barrier=createManagedAsyncBarrier({queue,signal:controller.signal});barrier.track('job');controller.abort();
 await expect(barrier.settle()).rejects.toThrow();expect(queue.cancel).toHaveBeenCalledWith('job');
});
