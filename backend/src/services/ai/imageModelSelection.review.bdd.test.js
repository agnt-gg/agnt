import { describe, it, expect, vi } from 'vitest';
import { resolveOpenAiImageSelection as resolve } from './imageModelSelection.js';
const list = (...ids) => async () => ({data:ids.map(id=>({id}))});
describe('Feature: honest image tiers and cancellation',()=>{
 it('Given only full models, When Fast is requested, Then fail instead of silently converging',async()=>{
  await expect(resolve({model:'latest-fast',listModels:list('gpt-image-2','gpt-image-3-sunburst')})).rejects.toThrow(/No compatible/);
 });
 it('Given a newer full model and an eligible speed model, Then Fast retains the speed tier',async()=>{
  expect((await resolve({model:'latest-fast',listModels:list('gpt-image-3','gpt-image-2.5-flare')})).resolvedModel).toBe('gpt-image-2.5-flare');
 });
 it.each(['latest','gpt-image-2'])('Given cancellation before selection %s, Then do not discover or return a request model',async model=>{
  const c=new AbortController();c.abort();const listModels=vi.fn();
  await expect(resolve({model,listModels,signal:c.signal})).rejects.toThrow(/cancel/i);expect(listModels).not.toHaveBeenCalled();
 });
 it('Given pending discovery, When cancelled, Then settle and abort without retry',async()=>{
  const c=new AbortController();const listModels=vi.fn(()=>new Promise(()=>{}));
  const promise=resolve({listModels,signal:c.signal,timeoutMs:1000});
  await vi.waitFor(()=>expect(listModels).toHaveBeenCalledOnce());c.abort();
  await expect(promise).rejects.toThrow(/cancel/i);expect(listModels.mock.calls[0][0].signal.aborted).toBe(true);
 });
 it('Given discovery resolves concurrently with cancellation, Then no late success',async()=>{
  const c=new AbortController();await expect(resolve({signal:c.signal,listModels:async()=>{c.abort();return {data:[{id:'gpt-image-2'}]};}})).rejects.toThrow(/cancel/i);
 });
});
