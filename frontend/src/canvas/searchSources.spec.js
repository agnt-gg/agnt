import {describe,it,expect,vi} from 'vitest';
import {loadSearchSources,historySearchItems,SEARCH_SOURCES,marketplaceSearch,marketplaceStoreItems,storeRelevance} from './searchSources.js';
describe('search catalog sources',()=>{
 it('loads every metadata collection without touching screen stores',async()=>{const onSource=vi.fn(),onError=vi.fn();const fetcher=vi.fn(async()=>({ok:true,json:async()=>Object.fromEntries(SEARCH_SOURCES.map(s=>[s[3],[]]))}));await loadSearchSources({token:'token',onSource,onError,fetcher});expect(onSource).toHaveBeenCalledTimes(9);expect(onError).not.toHaveBeenCalled();expect(fetcher.mock.calls.every(([,opts])=>opts.headers.Authorization==='Bearer token')).toBe(true)});
 it('reports partial failure while retaining the other collections',async()=>{const onSource=vi.fn(),onError=vi.fn();await loadSearchSources({token:'token',onSource,onError,fetcher:vi.fn(async url=>url.includes('/skills')?{ok:false,status:503}:{ok:true,json:async()=>Object.fromEntries(SEARCH_SOURCES.map(s=>[s[3],[]]))})});expect(onSource).toHaveBeenCalledTimes(8);expect(onError).toHaveBeenCalledWith('Skills','HTTP 503')});
 it('does not publish stale results after cancellation',async()=>{const abort=new AbortController(),onSource=vi.fn();await loadSearchSources({token:'t',signal:abort.signal,onSource,onError:vi.fn(),fetcher:vi.fn(async()=>{abort.abort();return {ok:true,json:async()=>({outputs:[]})}})});expect(onSource).not.toHaveBeenCalled()});
 it('preserves canonical conversation and output identities',()=>{const rows=historySearchItems([{kind:'conversation',id:'c1',title:'Prompt',meta:{conversation_id:'c1'}},{kind:'output',id:'o1',title:'Saved',meta:{content_type:'conversation',conversation_id:'c1'}},{kind:'execution',id:'e1',meta:{execution_id:'e1'}}]);expect(rows[0].action).toEqual({type:'conversation',id:'c1'});expect(rows[1].id).toBe('chat:o1');expect(rows[1].action.id).toBe('o1');expect(rows[2].action).toMatchObject({kind:'trace',id:'e1'});expect(rows.every(r=>r.serverMatched)).toBe(true)});
});

describe('store suggestions for an empty local search',()=>{
 const listing=(over={})=>({id:'l-'+(over.asset_id||'a'),asset_id:'a',asset_type:'agent',title:'Title',price:0,...over});
 const ok=(items)=>({ok:true,json:async()=>({items})});

 // The longest word missing must not end the search: 'nonexistent' is longer
 // than 'triage', and stopping there would hide the agent being reached for.
 it('keeps trying words until one answers, not just the longest',async()=>{
  const hit=listing({asset_id:'triage',title:'Email Triage Agent'});
  const fetcher=vi.fn(async(url)=>(url.includes('search=triage')?ok([hit]):ok([])));
  const items=await marketplaceSearch('nonexistent triage',{fetcher});
  expect(items).toEqual([hit]);
  expect(fetcher.mock.calls.map(([url])=>decodeURIComponent(url).split('search=')[1]))
   .toEqual(['nonexistent triage','nonexistent','triage']);
 });

 it('caps retries so one keystroke cannot become a dozen round trips',async()=>{
  const fetcher=vi.fn(async()=>ok([]));
  expect(await marketplaceSearch('alpha bravo charlie delta echo foxtrot',{fetcher})).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(4); // the phrase, then 3 words
 });

 it('ignores words too short to be distinctive',async()=>{
  const fetcher=vi.fn(async()=>ok([]));
  await marketplaceSearch('an of triage',{fetcher});
  expect(fetcher.mock.calls.map(([url])=>decodeURIComponent(url).split('search=')[1]))
   .toEqual(['an of triage','triage']);
 });

 it('asks once when the phrase itself matches',async()=>{
  const fetcher=vi.fn(async()=>ok([listing()]));
  await marketplaceSearch('agent',{fetcher});
  expect(fetcher).toHaveBeenCalledTimes(1);
 });

 it('sends no request for a blank query',async()=>{
  const fetcher=vi.fn();
  expect(await marketplaceSearch('   ',{fetcher})).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled();
 });

 it('propagates transport failure so the caller can stay quiet about it',async()=>{
  await expect(marketplaceSearch('agent',{fetcher:async()=>({ok:false,status:502})})).rejects.toThrow('HTTP 502');
 });

 it('ranks a title hit above a description hit, and breaks ties by installs',()=>{
  const titleHit=listing({asset_id:'t',title:'Invoice Parser'});
  const blurbHit=listing({asset_id:'b',title:'Unrelated',description:'parses an invoice'});
  const popular=listing({asset_id:'p',title:'Invoice Parser',installs:99});
  const rows=marketplaceStoreItems([blurbHit,titleHit,popular],'invoice');
  expect(rows.map(r=>r.action.assetId)).toEqual(['p','t','b']);
  expect(storeRelevance(titleHit,'invoice')).toBeGreaterThan(storeRelevance(blurbHit,'invoice'));
 });

 it('navigates by stable asset id, never the listing uuid',()=>{
  const [row]=marketplaceStoreItems([listing({asset_id:'agnt-email-triage',id:'uuid-that-changes'})],'email');
  expect(row.action).toEqual({type:'store',assetId:'agnt-email-triage'});
  expect(row.id).toBe('store:uuid-that-changes');
 });

 it('drops listings with no asset id, since they cannot be opened',()=>{
  expect(marketplaceStoreItems([{id:'x',title:'Orphan'}],'orphan')).toEqual([]);
 });

 it('prices free and paid listings honestly, and caps the list',()=>{
  const [free,paid]=marketplaceStoreItems([listing({asset_id:'f'}),listing({asset_id:'p',price:12.5,asset_type:'skill'})],'title');
  expect(free.hint).toBe('agent · free');
  expect(paid.hint).toBe('skill · $12.50');
  expect(paid.icon).toBe('fas fa-graduation-cap');
  expect(marketplaceStoreItems(Array.from({length:30},(_,i)=>listing({asset_id:'a'+i})),'title')).toHaveLength(8);
 });
});
