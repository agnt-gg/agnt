import { describe, it, expect, vi } from 'vitest';
vi.mock('@/services/chatService.js', () => ({ cancelRun: vi.fn(async () => {}), reattachRun: vi.fn(), fetchConversation: vi.fn() }));
import chat from './chat.js';

describe('Stop reader cleanup', () => {
  it('awaits and consumes the asynchronous AbortError then settles the conversation', async () => {
    const error = new DOMException('Aborted', 'AbortError');
    const cancel = vi.fn(() => Promise.reject(error));
    const abort = vi.fn();
    const commit = vi.fn();
    const state = { activeConversationId:'temp-one', conversations:{'temp-one':{conversationId:'temp-one',streamAbortController:{abort},streamReader:{cancel},activeAsyncTools:new Map()}},activeAsyncTools:new Map(),streamEventCallbacks:new Set(),isStreaming:true };
    await chat.actions.stopStreamingConversation({state,commit});
    expect(abort).toHaveBeenCalledOnce();expect(cancel).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith('SCOPED_SET_STREAMING',{conversationId:'temp-one',value:false});
    expect(commit).toHaveBeenCalledWith('SCOPED_SET_STREAM_READER',{conversationId:'temp-one',reader:null});
    expect(state.isStreaming).toBe(false);
  });
  it('reports unexpected reader cleanup failures while still settling Stop', async () => {
    const warn=vi.spyOn(console,'warn').mockImplementation(()=>{}),commit=vi.fn();
    const state={activeConversationId:'temp-two',conversations:{'temp-two':{conversationId:'temp-two',streamReader:{cancel:()=>Promise.reject(new Error('reader failed'))},activeAsyncTools:new Map()}},activeAsyncTools:new Map(),streamEventCallbacks:new Set(),isStreaming:true};
    await chat.actions.stopStreamingConversation({state,commit});expect(warn).toHaveBeenCalledWith('[Chat] Reader cleanup after stop failed:',expect.any(Error));expect(state.isStreaming).toBe(false);warn.mockRestore();
  });
});
