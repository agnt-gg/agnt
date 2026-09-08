import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { applyStreamEvent, createAssistantMessage } from '@/services/chatStreamReducer.js';
import { serializeTranscript, parseTranscript } from '@/services/conversationTranscript.js';
vi.mock('@/../user.config.js', () => ({API_CONFIG:{BASE_URL:'http://invalid.test/api'},IMAP_EMAIL_DOMAIN:'',AI_PROVIDERS_CONFIG:{},DEPLOYMENT_CONFIG:{},default:{}}));
vi.mock('@/assets/images/annie-avatar.png', () => ({default:'avatar.png'}));
vi.mock('highlight.js/styles/atom-one-dark.css', () => ({}));
import MessageItem from './MessageItem.vue';
const metadata=[{type:'voice-input',kind:'correlated-delegation',utteranceId:'test-u',observedTranscript:'Move it',delegatedInterpretation:'Move it only after backup.'}];
describe('authoritative final rendered and hydrated equality (offline)', () => {
  it.each(['No, do not do it.', '', 'Nein. Erst nach dem Backup.'])('replaces draft with %s without losing tools/provenance', final => {
    const message=createAssistantMessage({id:'test-m'}); message.metadata=metadata;
    applyStreamEvent(message,'content_delta',{delta:'Yes, do it.'});
    applyStreamEvent(message,'tool_start',{toolCall:{id:'test-tool',name:'read_file',args:{path:'synthetic'}}});
    applyStreamEvent(message,'tool_end',{toolCall:{id:'test-tool',name:'read_file',result:'fixture'}});
    applyStreamEvent(message,'final_content',{content:final});
    const hydrated=parseTranscript(serializeTranscript({conversationId:'TEST-offline',messages:[message]})).messages[0];
    expect(hydrated.content).toBe(final); expect(hydrated.contentParts).toEqual(message.contentParts);
    expect(hydrated.metadata).toEqual(metadata); expect(hydrated.toolCalls).toHaveLength(1);
    const store=createStore({state:{agents:{agents:[]},chat:{activeConversationId:null,conversations:{}}}});
    const wrapper=mount(MessageItem,{props:{message:hydrated,status:null,imageCache:new Map()},global:{plugins:[store],stubs:{ProviderSetup:true,GoalProgressWidget:true,Tooltip:true,Teleport:true}}});
    try { expect(wrapper.text()).not.toContain('Yes, do it.'); if(final) expect(wrapper.text()).toContain(final); }
    finally { wrapper.unmount(); }
  });
});
