import {it,expect,vi} from 'vitest';
import {createDurableToolDispatch} from './durableToolDispatch.js';
it('dispatches once and saves nested failure as failed',async()=>{
 const operations={begin:vi.fn(async()=>({id:'one',dispatch:true})),finish:vi.fn(async()=>true)};
 const dispatch=createDurableToolDispatch({claim:{},operations,receipts:{write:async()=> 'receipt'},assertOwnership:async()=>{},segmentId:'segment'});
 const execute=vi.fn(async()=>({success:false,error:'rejected'}));
 expect(await dispatch({toolCallId:'call',name:'tool',args:{},execute})).toEqual({success:false,error:'rejected'});
 expect(execute).toHaveBeenCalledOnce();expect(operations.finish.mock.calls[0][2].status).toBe('failed');
});
it('reuses completed receipts and never invokes the effect twice',async()=>{
 const execute=vi.fn();
 const dispatch=createDurableToolDispatch({claim:{},operations:{begin:async()=>({dispatch:false,status:'completed',resultRef:'receipt'})},receipts:{read:async()=>({success:true})},assertOwnership:async()=>{},segmentId:'segment'});
 expect(await dispatch({toolCallId:'call',name:'tool',args:{},execute})).toEqual({success:true});expect(execute).not.toHaveBeenCalled();
});
it('a thrown effect is explicitly uncertain and cannot invite a blind retry',async()=>{
 const dispatch=createDurableToolDispatch({claim:{},operations:{begin:async()=>({id:'operation',dispatch:true})},receipts:{},assertOwnership:async()=>{},segmentId:'segment'});
 await expect(dispatch({toolCallId:'call',name:'tool',args:{},execute:async()=>{throw Error('Connection lost after write');}})).rejects.toMatchObject({code:'operation_uncertain'});
});
it('uncertain operation does not dispatch',async()=>{
 const execute=vi.fn();
 const dispatch=createDurableToolDispatch({claim:{},operations:{begin:async()=>({dispatch:false,status:'unknown'})},receipts:{},assertOwnership:async()=>{},segmentId:'segment'});
 await expect(dispatch({toolCallId:'call',name:'tool',args:{},execute})).rejects.toMatchObject({code:'operation_uncertain'});expect(execute).not.toHaveBeenCalled();
});
