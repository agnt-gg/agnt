import {it,expect,vi} from 'vitest';
import {createManagedAsyncCompletion} from './managedAsyncCompletion.js';
it('persists the result before waking the existing scheduler',async()=>{
 const order=[];
 const callbacks=createManagedAsyncCompletion({work:{id:'work',owner_id:'owner'},snapshots:{forWork:()=>({write:async()=>{order.push('persist');return 'receipt';}})},inbox:{append:async()=>{order.push('inbox');return true;}},store:{wake:async()=>order.push('wake')},scheduler:{tick:async()=>order.push('schedule')}});
 await callbacks.onComplete({success:true},{executionId:'job'});
 expect(order).toEqual(['persist','inbox','wake','schedule']);
});
it('failed result remains a failure receipt, not completed task evidence',async()=>{
 const write=vi.fn(async()=> 'receipt');
 const callbacks=createManagedAsyncCompletion({work:{},snapshots:{forWork:()=>({write})},inbox:{append:async()=>false},store:{wake:vi.fn()},scheduler:{tick:async()=>{}}});
 await callbacks.onError(Error('Failed'),{executionId:'job'});
 expect(write.mock.calls[0][0].result).toEqual({success:false,error:'Failed'});
});
