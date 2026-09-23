import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
vi.mock('../../models/database/index.js', () => ({ default: {} }));
import Memory from '../../models/AgentMemoryModel.js';
import { injectTaskMemory, userMessageText } from './taskMemory.js';
import { estimateTokens } from '../../utils/contextManager.js';
const lesson = { id: 'release', memory_type: 'pattern', content: 'Inspect native release architecture.' };
beforeEach(() => vi.restoreAllMocks());
describe('per-turn task memory', () => {
  it('updates task context without changing previous messages or frozen prefix', async () => {
    const lookup = vi.spyOn(Memory, 'searchRelevant').mockResolvedValueOnce([lesson]).mockResolvedValueOnce([{...lesson,id:'mail',content:'Verify mail delivery.'}]);
    const context = { userId:'u1', _frozenMemorySection:'UNCHANGED', latestUserMessage:'inspect native release' };
    const messages = [{role:'system',content:'STABLE SYSTEM'}, {role:'user',content:'inspect native release'}];
    await injectTaskMemory(messages, context);
    const prior = JSON.stringify(messages);
    messages.push({role:'assistant',content:'Inspected'}, {role:'user',content:'check mail delivery'});
    context.latestUserMessage = 'check mail delivery';
    await injectTaskMemory(messages, context);
    expect(JSON.stringify(messages.slice(0,2))).toBe(prior);
    expect(context._frozenMemorySection).toBe('UNCHANGED');
    expect(messages.at(-1).content).toContain('id="mail"');
    expect(context.taskMemoryIds).toEqual(['mail']);
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it('supplements short continuations but not substantive topic switches', async () => {
    const lookup = vi.spyOn(Memory,'searchRelevant').mockResolvedValue([]);
    await injectTaskMemory([{role:'user',content:'inspect packaged native architecture'},{role:'assistant',content:'proposal'},{role:'user',content:'implement that'}],{userId:'u1'});
    expect(lookup.mock.calls[0][0].query).toContain('inspect packaged native architecture');
    await injectTaskMemory([{role:'user',content:'inspect packaged native architecture'},{role:'user',content:'diagnose mail delivery rejection'}],{userId:'u1'});
    expect(lookup.mock.calls[1][0].query).not.toContain('architecture');
  });
  it('preserves multimodal blocks and adds only one packet', async () => {
    const lookup = vi.spyOn(Memory,'searchRelevant').mockResolvedValue([lesson]);
    const image = {type:'image_url',image_url:{url:'data:image/png;base64,fixture'}};
    const original = Object.freeze({role:'user',content:Object.freeze([{type:'text',text:'native release architecture'},image])});
    const messages = [original];
    await injectTaskMemory(messages,{userId:'u1'});
    await injectTaskMemory(messages,{userId:'u1'});
    expect(messages[0].content).toHaveLength(3);
    expect(messages[0].content[1]).toBe(image);
    expect(original.content).toHaveLength(2);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it('does not trust a user-supplied packet marker to suppress retrieval', async () => {
    const lookup = vi.spyOn(Memory,'searchRelevant').mockResolvedValue([lesson]);
    const messages = [{role:'user',content:'[AGNT TASK MEMORY] native architecture'}];
    await injectTaskMemory(messages,{userId:'u1'});
    expect(lookup).toHaveBeenCalledOnce();
    expect(messages[0].content).toContain('id="release"');
  });
  it('leaves empty results alone and logs retrieval errors without invented data', async () => {
    const lookup = vi.spyOn(Memory,'searchRelevant').mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('FTS unavailable'));
    const warn = vi.spyOn(console,'warn').mockImplementation(()=>{});
    for(let i=0;i<2;i++) {
      const messages=[{role:'user',content:'native architecture'}];
      await injectTaskMemory(messages,{userId:'u1'});
      expect(messages[0].content).toBe('native architecture');
    }
    expect(warn).toHaveBeenCalledWith('[TaskMemory] Retrieval failed:','FTS unavailable');
    expect(lookup).toHaveBeenCalledTimes(2);
  });
  it('does not search without user identity or user message', async () => {
    const lookup=vi.spyOn(Memory,'searchRelevant');
    await injectTaskMemory([{role:'user',content:'native'}],{});
    await injectTaskMemory([{role:'assistant',content:'native'}],{userId:'u1'});
    expect(lookup).not.toHaveBeenCalled();
  });
  it('caps the whole packet at 1500 tokens', async () => {
    vi.spyOn(Memory,'searchRelevant').mockResolvedValue(Array.from({length:5},(_,i)=>({...lesson,id:String(i),content:'Very large native architecture finding '.repeat(1000)})));
    const messages=[{role:'user',content:'native release'}];
    await injectTaskMemory(messages,{userId:'u1'});
    expect(estimateTokens(messages[0].content.slice('native release'.length))).toBeLessThanOrEqual(1500);
  });
  it('extracts user text without serializing images', () => {
    expect(userMessageText({content:[{type:'image_url',image_url:'secret'},{type:'text',text:'actual user'}]})).toBe('actual user');
  });
  // Recall is delivered through the FROZEN system block, not by rewriting the
  // newest user message. Appending to that message rewrites bytes the next
  // request cannot reproduce (history is rebuilt clean from storage), so the
  // cached prefix misses on every turn after the first. Same failure shape as
  // the deleted date injector - see OrchestratorService.historyCacheStability.
  it('never rewrites request-path history to deliver recall', () => {
    const source=fs.readFileSync(new URL('../OrchestratorService.js',import.meta.url),'utf8');
    expect(source).not.toContain('await injectTaskMemory(');
    expect(source).not.toContain('injectDateIntoLastUserMessage');
    expect(source).toContain('conversationContext.executionId = execId');
    expect(source).toContain('latestUserMessage: conversationContext.latestUserMessage');
    const config=fs.readFileSync(new URL('./chatConfigs.js',import.meta.url),'utf8');
    expect(config).toContain("context._frozenMemorySection = ''");
    expect(config).toContain("context.memoryInSystemPrompt !== false && context.userId");
    expect(config).toContain('searchRelevant');
    expect(config).not.toContain('async function loadMemorySection');
  });

  // Anti-vacuity: proves the guard above is load-bearing. Injecting into the
  // newest user message really does desynchronise turn 1's cached bytes from
  // the clean history turn 2 rebuilds.
  it('negative control: injecting into the user message breaks the next turn prefix', async () => {
    vi.spyOn(Memory,'searchRelevant').mockResolvedValue([lesson]);
    const turnOne=[{role:'user',content:'inspect native release'}];
    await injectTaskMemory(turnOne,{userId:'u1'});
    const turnTwo=[{role:'user',content:'inspect native release'},{role:'assistant',content:'ok'},{role:'user',content:'next'}];
    await injectTaskMemory(turnTwo,{userId:'u1'});
    expect(turnTwo[0]).not.toEqual(turnOne[0]);
  });
});
