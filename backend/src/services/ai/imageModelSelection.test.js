import { describe, it, expect, vi } from 'vitest';
import * as registry from './ProviderRegistry.js';
const call = (models, model, extra = {}) => registry.resolveOpenAiImageSelection({ model, operation: 'Generate', listModels: async () => ({ data: models.map(id => typeof id === 'string' ? { id } : id) }), ...extra });

describe('execution-time OpenAI image selection', () => {
  it('defaults to a policy, not a version', () => expect(registry.getDefaultImageModel('openai')).toBe('latest'));
  it('resolves the quality sibling', async () => expect((await call(['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'])).resolvedModel).toBe('gpt-image-2.5-sunburst'));
  it('resolves the speed sibling explicitly', async () => expect((await call(['gpt-image-2.5-sunburst','gpt-image-2.5-flare'], 'latest-fast')).resolvedModel).toBe('gpt-image-2.5-flare'));
  it('compares version components numerically, not created timestamp', async () => expect((await call([{id:'gpt-image-2.9',created:999},{id:'gpt-image-2.10',created:1}])).resolvedModel).toBe('gpt-image-2.10'));
  it('advances a compatible stable family without another default literal', async () => expect((await call(['gpt-image-2.5-sunburst','gpt-image-3'])).resolvedModel).toBe('gpt-image-3'));
  it('ignores dated snapshots and previews in automatic mode', async () => expect((await call(['gpt-image-2','gpt-image-3-preview','gpt-image-9-2026-09-08','chatgpt-image-latest'])).resolvedModel).toBe('gpt-image-2'));
  it('does not rank unknown variants alphabetically', async () => expect((await call(['gpt-image-2.5-flare','gpt-image-2.5-sunburst','gpt-image-9-mystery'])).resolvedModel).toBe('gpt-image-2.5-sunburst'));
  it('respects catalog deprecation flags', async () => expect((await call(['gpt-image-2',{id:'gpt-image-3',deprecated:true}])).resolvedModel).toBe('gpt-image-2'));
  it.each(['gpt-image-1','gpt-image-2.5-sunburst-2026-09-08'])('retains explicit pin %s without discovery', async model => { const listModels=vi.fn(); const out=await call([],model,{listModels}); expect(out.resolvedModel).toBe(model); expect(out.requestedModel).toBe(model); expect(out.selectionMode).toBe('pinned'); expect(listModels).not.toHaveBeenCalled(); });
  it('distinguishes requested policy from returned engine identity', async () => {const out=await call(['gpt-image-2']);expect(out.requestedModel).toBe('latest');expect(out.returnedModel).toBeNull();expect(out.catalogSource).toBe('openai.models.list');expect(out.catalogFetchedAt).toMatch(/^\d{4}-/);});
  it.each([[[]],[['gpt-6-astra']],[['gpt-image-2.5-sunburst-2026-09-08']]])('fails without eligible fresh models (%j)', async rows=>{await expect(call(rows)).rejects.toThrow(/No compatible/);});
  it('does not fall back on a catalog error', async()=>{const listModels=vi.fn().mockRejectedValue(new Error('offline'));await expect(call([],undefined,{listModels})).rejects.toThrow(/offline/);expect(listModels).toHaveBeenCalledTimes(1);});
  it('has bounded discovery and no retry', async()=>{const listModels=vi.fn(()=>new Promise(()=>{}));await expect(call([],undefined,{listModels,timeoutMs:10})).rejects.toThrow(/timed out/);expect(listModels.mock.calls[0][0].maxRetries).toBe(0);expect(listModels.mock.calls[0][0].signal.aborted).toBe(true);});
  it('does not share a catalog between accounts or concurrent calls', async()=>{const [a,b]=await Promise.all([call(['gpt-image-2']),call(['gpt-image-3'])]);expect(a.resolvedModel).toBe('gpt-image-2');expect(b.resolvedModel).toBe('gpt-image-3');});
  it('re-reads on each request rather than silently caching',async()=>{const listModels=vi.fn().mockResolvedValueOnce({data:[{id:'gpt-image-2'}]}).mockResolvedValueOnce({data:[{id:'gpt-image-3'}]});expect((await call([],undefined,{listModels})).resolvedModel).toBe('gpt-image-2');expect((await call([],undefined,{listModels})).resolvedModel).toBe('gpt-image-3');});
  it('rejects malformed catalogs', async()=>{await expect(call([],undefined,{listModels:async()=>({})})).rejects.toThrow(/catalog/);});
  it('rejects truncation rather than pretending a partial list is latest', async()=>{await expect(call([],undefined,{listModels:async()=>({data:[{id:'gpt-image-2'}],has_more:true})})).rejects.toThrow(/catalog/);});
  it.each([['dall-e-3','Edit'],['gpt-image-2','Variation'],['latest','Variation']])('never substitutes %s for %s',async(model,operation)=>{await expect(call([],model,{operation})).rejects.toThrow(/support|requires/i);});
  it('preserves explicit DALL-E 2 variation',async()=>expect((await call([],'dall-e-2',{operation:'Variation'})).resolvedModel).toBe('dall-e-2'));
  it.each([
    [['gpt-image-2','gpt-image-2','gpt-image-2.0']],
    [['gpt-image-2.0','gpt-image-2','gpt-image-2']],
  ])('rejects every distinct top-ranked ID even behind duplicates (%j)', async rows => { await expect(call(rows)).rejects.toThrow(/Ambiguous/); });
  it('leaves other provider defaults unchanged',()=>{expect(registry.getDefaultImageModel('gemini')).not.toBe('latest');expect(registry.getDefaultImageModel('grokai')).not.toBe('latest');expect(registry.supportsImageGeneration('openai-codex')).toBeFalsy();});
});
