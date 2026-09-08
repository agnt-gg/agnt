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

  chat = (await import('./chat.js')).default;

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
const wire=frame('conversation_started',{conversationId:AGENT_CONV})+frame('agent_execution_started',{executionId:'run-voice'})+frame('assistant_message',{id:'answer-voice'})+frame('final_content',{assistantMessageId:'answer-voice',content:'No, do not do it.'})+frame('done',{receiptVersion:1,binding:'authenticated-user-execution',requestId:'request',userId:'user',provider:'chosen-provider',model:'chosen-model',conversationId:AGENT_CONV,executionId:'run-voice',assistantMessageId:'answer-voice',accepted:true,completed:true,success:true,status:'completed',executionPersisted:true,transcriptPersisted:true});
const tick=()=>new Promise(r=>setTimeout(r,0));
describe.each(['startStreamingConversation','startAgentStreamingConversation'])('real store SSE reader %s',action=>{
 function submitWithReader(reader,onSpeech=vi.fn()) {
  global.fetch=vi.fn(async()=>({ok:true,body:{getReader:()=>reader}}));
  const submit=createNativeVoiceSubmit({send:(text,options)=>chat.actions[action](
   {commit,state,dispatch,rootState:{userAuth:{sessionState:'valid',user:{id:'user'}},aiProvider:GLOBAL_AI,agents:{agents:[]}}},
   {agentId:AGENT_ID,userInput:text,conversationId:AGENT_CONV,provider:'chosen-provider',model:'chosen-model',...options})});
  return {pending:submit({text:'Move only after backup.',transcript:'Move',utteranceId:'voice-current',delegatedInterpretation:'Move only after backup.',commitKind:'correlated-delegation',onSpeech}),onSpeech};
 }
 it('awaits EOF, emits exact final, preserves request routing and voice mode',async()=>{
  let release;let n=0;
  state.aiByConv[AGENT_CONV]={provider:'chosen-provider',model:'chosen-model'};
  const {pending,onSpeech}=submitWithReader({read:vi.fn(()=>++n===1?Promise.resolve({value:new TextEncoder().encode(wire),done:false}):new Promise(r=>release=r))});
  let settled=false;pending.then(()=>settled=true);await tick();expect(settled).toBe(false);expect(onSpeech).not.toHaveBeenCalled();
  release({done:true});expect(await pending).toMatchObject({accepted:true,completed:true,executionId:'run-voice'});
  expect(onSpeech).toHaveBeenCalledWith('No, do not do it.','answer-voice');
  expect(global.fetch.mock.calls[0][1].headers['X-AGNT-Voice-Request-Id']).toBe('request');
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({routingMode:'pinned',conversationId:AGENT_CONV});
  expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({provider:'chosen-provider',model:'chosen-model',voiceMode:true,voiceMetadata:[{type:'voice-input',kind:'correlated-delegation',utteranceId:'voice-current',observedTranscript:'Move',delegatedInterpretation:'Move only after backup.'}]});
 });
 it('EOF without terminal cannot claim completed',async()=>{
  let n=0;const {pending,onSpeech}=submitWithReader({read:async()=>++n===1?{done:false,value:new TextEncoder().encode(wire.split('event: done')[0])}:{done:true}});
  expect(await pending).toMatchObject({accepted:true,completed:false,status:'unknown'});expect(onSpeech).not.toHaveBeenCalled();
 });
 it('read failure after terminal retains acceptance but forbids speech',async()=>{
  let n=0;const {pending,onSpeech}=submitWithReader({read:async()=>{if(++n===1)return{done:false,value:new TextEncoder().encode(wire)};throw Error('fixture disconnect');}});
  expect(await pending).toMatchObject({accepted:true,completed:false,status:'failed'});expect(onSpeech).not.toHaveBeenCalled();
 });
 it('malformed event after terminal is not silent completion',async()=>{
  let n=0;const {pending,onSpeech}=submitWithReader({read:async()=>++n===1?{done:false,value:new TextEncoder().encode(wire+'event: done\ndata: nope\n\n')}:{done:true}});
  expect(await pending).toMatchObject({accepted:true,completed:false,status:'failed'});expect(onSpeech).not.toHaveBeenCalled();
 });
});
