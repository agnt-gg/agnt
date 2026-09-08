import { serializeTranscript, parseTranscript } from '@/services/conversationTranscript.js';
import { streamChat } from '@/services/chatService.js';
import { nativeVoiceMetadata } from '@/voice/nativeVoiceSubmit.js';
// Mid-run steering: transcript ordering contract.
//
// A turn used to stream into exactly ONE assistant bubble for its entire life.
// When a steer landed at a tool-round seam the frontend pushed the steer text
// as a new user message at the TAIL of the transcript -- but every subsequent
// content_delta still targeted the assistant bubble that already sat ABOVE it.
// Net effect: the agent's post-steer output rendered above the steer, so the
// steer appeared to land after the very work it caused.
//
// The fix splits the assistant turn at the seam: the backend seals the
// outgoing bubble (carrying its id on `steering_applied`) and mints a fresh
// `assistant_message` immediately after, so post-steer deltas land BELOW the
// steer. These tests pin that contract end to end through the real event
// handler and the real mutations.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/chatService.js', () => ({ streamChat: vi.fn(), toChatHistory: vi.fn() }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelRouting: vi.fn(() => ({ mode: 'pinned', provider: 'p', model: 'm' })),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));

it('unified send preserves unknown provenance in local message and current request',async()=>{
 const voiceMetadata={commitKind:'unknown-input',utteranceId:'TEST-current',transcript:'Move',delegatedInterpretation:'Move only after backup.'};
 await chatUnified.actions.sendMessage({state,commit,dispatch:vi.fn(),rootState:{aiProvider:{}}},{channelKey:CHANNEL,chatType:'agent',content:'Move only after backup.',voiceMetadata,provider:'selected',model:'selected-model'});
 expect(messages()[0].metadata).toEqual(nativeVoiceMetadata(voiceMetadata));
 expect(messages()[0].metadata[0].kind).toBe('unknown');
 expect(streamChat).toHaveBeenCalledWith(expect.objectContaining({voiceMetadata:nativeVoiceMetadata(voiceMetadata),provider:'selected',model:'selected-model'}));
});

const CHANNEL = 'agent:test';

let chatUnified;
let handleStreamEvent;
let state;
let commit;

const makeState = () => ({
  conversations: {},
  streamingChannels: {},
  loadingSuggestionsChannels: {},
  expandedToolCalls: {},
  runningToolCalls: {},
  messageStates: {},
  abortControllers: {},
  pendingSteers: {},
  _migrated: {},
});

/** Drive one SSE event through the real handler. */
const emit = (eventName, data) =>
  handleStreamEvent({ commit, channelKey: CHANNEL, eventName, data });

const messages = () => state.conversations[CHANNEL].messages;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  const mod = await import('@/store/features/chatUnified.js');
  chatUnified = mod.default;
  handleStreamEvent = mod.handleStreamEvent;
  state = makeState();
  commit = (type, payload) => {
    const fn = chatUnified.mutations[type];
    if (!fn) throw new Error(`unknown mutation: ${type}`);
    fn(state, payload);
  };
});
it('unified host final-authoritative text and parts agree',()=>{emit('assistant_message',{id:'a',role:'assistant',content:''});emit('content_delta',{assistantMessageId:'a',delta:'Yes, do it.'});emit('final_content',{assistantMessageId:'a',content:'No, do not do it.'});const m=messages().find(m=>m.id==='a');console.log('REVIEW6_UNIFIED',JSON.stringify(m));expect(m.content).toBe('No, do not do it.');expect(m.contentParts.filter(p=>p.type==='text').map(p=>p.text).join('')).toBe('No, do not do it.'); const hydrated=parseTranscript(serializeTranscript({messages:[m]})).messages[0]; expect(hydrated.content).toBe('No, do not do it.'); expect(hydrated.contentParts).toEqual(m.contentParts);});
