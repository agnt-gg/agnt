import { serializeTranscript, parseTranscript } from '@/services/conversationTranscript.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

vi.mock('@/views/_components/base/ChatWindow', () => ({ Message: class {}, ChatWindow: class {} }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://localhost:3333' } }));
vi.mock('@/services/chatChannelConfig.js', () => ({
  resolveChannelProviderModel: vi.fn(),
  resolveChannelEnabledTools: vi.fn(),
}));
vi.mock('@/composables/useRealtimeSync.js', () => ({ emitSteer: vi.fn(), emitClearSteer: vi.fn() }));
vi.mock('@/utils/safeTruncate.js', () => ({ safeTruncate: (s) => s }));
vi.mock('@/services/chatService.js', () => ({
  reattachRun: vi.fn(),
  cancelRun: vi.fn(),
  fetchConversation: vi.fn(),
}));
vi.mock('@/services/voiceTurn.js', () => ({ consumeVoiceTurn: () => false }));

const AGENT_ID = 'agent-42';
const AGENT_CONV = 'conv-agent-uuid';

/** The orchestrator's popover — the value that must never leak onto the wire. */
const GLOBAL_AI = {
  selectedProvider: 'GLOBAL-PROVIDER',
  selectedModel: 'GLOBAL-MODEL',
  reasoningValue: 'high',
  reasoningEnabled: true,
};

let chat;
let state;
let commit;
let dispatch;

const makeState = () => ({
  activeConversationId: null,
  currentConversationId: null,
  unreadOutputIds: {},
  pendingSteer: '',
  messages: [],
  conversations: {},
  agentConversations: {},
  activeSkillByConv: {},
  activeGoalByConv: {},
  aiByConv: {},
  streamEventCallbacks: [],
  autosaveEnabled: true,
  currentAgentId: null,
  currentAgentName: null,
  currentAgentAvatar: null,
  savedMainConversationId: null,
});

/** Run one agent turn and return the parsed request body. */
async function sendAgentTurn(payload = {}) {
  await chat.actions.startAgentStreamingConversation(
    { commit, state, dispatch, rootState: { aiProvider: { ...GLOBAL_AI } } },
    { agentId: AGENT_ID, userInput: 'hi', conversationId: AGENT_CONV, ...payload },
  );
  expect(global.fetch).toHaveBeenCalled();
  return JSON.parse(global.fetch.mock.calls[0][1].body);
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('token', 't');
  // ok:true + no body ends the turn in the catch after the request is built,
  // which is all these tests need and keeps them independent of the SSE reducer.
  global.fetch = vi.fn(async () => ({ ok: true, body: null }));

  chat = (await import('@/store/features/chat.js')).default;

  state = makeState();
  commit = vi.fn((type, payload) => {
    const fn = chat.mutations[type];
    if (fn) fn(state, payload);
  });
  dispatch = vi.fn(() => Promise.resolve());

  chat.mutations.ENSURE_CONVERSATION(state, AGENT_CONV);
  chat.mutations.SCOPED_SET_AGENT(state, {
    conversationId: AGENT_CONV, agentId: AGENT_ID, agentName: 'Scout', agentAvatar: null,
  });
});

// ---------------------------------------------------------------------------


beforeEach(()=>{vi.spyOn(globalThis.crypto,'randomUUID').mockReturnValue('request');state.aiByConv[AGENT_CONV]={provider:'chosen-provider',model:'chosen-model'};});
import { createNativeVoiceSubmit } from '@/voice/nativeVoiceSubmit.js';
const frame=(name,data)=>'event: '+name+'\ndata: '+JSON.stringify(data)+'\n\n';
const wire=frame('conversation_started',{conversationId:AGENT_CONV})+frame('agent_execution_started',{executionId:'run-voice'})+frame('assistant_message',{id:'answer-voice',role:'assistant',content:''})+frame('final_content',{assistantMessageId:'answer-voice',content:'No, do not do it.'})+frame('done',{receiptVersion:1,binding:'authenticated-user-execution',requestId:'request',userId:'user',provider:'chosen-provider',model:'chosen-model',conversationId:AGENT_CONV,executionId:'run-voice',assistantMessageId:'answer-voice',accepted:true,completed:true,success:true,status:'completed',executionPersisted:true,transcriptPersisted:true});
const tick=()=>new Promise(r=>setTimeout(r,0));

describe.each(['startStreamingConversation','startAgentStreamingConversation'])('review6 production store %s',action=>{
 async function run(raw){let n=0;global.fetch=vi.fn(async()=>({ok:true,body:{getReader:()=>({read:async()=>++n===1?{done:false,value:new TextEncoder().encode(raw)}:{done:true}})}}));const speech=[];const submit=createNativeVoiceSubmit({send:(text,options)=>chat.actions[action]({commit,state,dispatch,rootState:{userAuth:{sessionState:'valid',user:{id:'user'}},aiProvider:GLOBAL_AI,agents:{agents:[]}}},{agentId:AGENT_ID,userInput:text,conversationId:AGENT_CONV,provider:'chosen-provider',model:'chosen-model',...options})});const receipt=await submit({text:'Question',onSpeech:t=>speech.push(t)});return {receipt,speech};}
 it('authoritative correction reaches displayed and serialized store message',async()=>{const raw=wire.replace(frame('final_content',{assistantMessageId:'answer-voice',content:'No, do not do it.'}),frame('content_delta',{assistantMessageId:'answer-voice',delta:'Yes, do it.'})+frame('final_content',{assistantMessageId:'answer-voice',content:'No, do not do it.'}));const result=await run(raw);const message=state.conversations[AGENT_CONV].messages.find(m=>m.id==='answer-voice');console.log('REVIEW6_SCREEN_SPEECH',JSON.stringify({result,message}));expect(result.speech).toEqual(['No, do not do it.']);expect(message.content).toBe('No, do not do it.');expect(message.contentParts.filter(p=>p.type==='text').map(p=>p.text).join('')).toBe('No, do not do it.'); const hydrated=parseTranscript(serializeTranscript({messages:[message]})).messages[0]; expect(hydrated.content).toBe('No, do not do it.'); expect(hydrated.contentParts).toEqual(message.contentParts);});
 it('late delta cannot change displayed, saved or restored authoritative answer',async()=>{
  const result=await run(wire+frame('content_delta',{assistantMessageId:'answer-voice',delta:' Actually, do it.'}));
  expect(result.receipt.completed).toBe(true);
  const message=state.conversations[AGENT_CONV].messages.find(m=>m.id==='answer-voice');
  expect(message.content).toBe(result.speech[0]);
  const restored=parseTranscript(serializeTranscript({messages:[message]})).messages[0];
  expect(restored.content).toBe('No, do not do it.');
  expect(restored.contentParts.filter(p=>p.type==='text').map(p=>p.text).join('')).toBe(restored.content);
  expect(restored.streamFinalized).toBe(true);
 });
 it('truncated error frame after done cannot authorize speech',async()=>{const result=await run(wire+'event: error\ndata: {"error":"transport failure"');console.log('REVIEW6_TRUNCATED_TAIL',JSON.stringify(result));expect(result.receipt.completed).toBe(false);expect(result.speech).toEqual([]);});
});
