import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';
import { nextTick } from 'vue';
import ChatPanel from './ChatPanel.vue';

function fixture() {
  const store = createStore({ state: { chat: { messages: [], isStreaming: false }, agents: { agents: [] }, workflows: { workflows: [] }, goals: { goals: [] }, aiProvider: {} }, modules: { shell: { namespaced: true, state: () => ({ inspect: null }), getters: { inspect: s => s.inspect }, mutations: { set: (s,v) => s.inspect=v }, actions: { clearInspect: ({commit}) => commit('set',null) } } } });
  const ready = vi.fn();
  const wrapper = mount(ChatPanel, { props: { contextHostReady: ready, hasContext: true }, global: { plugins: [store], stubs: { EntityInspector: true, ArtifactPreview: true, InspectorShell: { template:'<div><slot/><slot name="footer"/></div>' }, InspSection: { template:'<section><slot/></section>' } } } });
  return { wrapper, store, ready };
}
describe('conversation-owned monitoring destination', () => {
 it('announces a real element, not a global selector', () => { const f=fixture();expect(f.ready).toHaveBeenCalledWith(expect.any(HTMLElement),expect.anything());expect(f.wrapper.find('[data-chat-context-host]').attributes('id')).toBeUndefined();f.wrapper.unmount(); });
 it('retains the same context target while inspecting a referenced entity', async () => { const f=fixture(),element=f.wrapper.find('[data-chat-context-host]').element;f.store.commit('shell/set',{kind:'agent',id:'agent-1'});await nextTick();expect(f.wrapper.find('[data-chat-context-host]').element).toBe(element);f.store.commit('shell/set',null);await nextTick();expect(f.wrapper.find('[data-chat-context-host]').element).toBe(element);f.wrapper.unmount(); });
 it('two chat panels have different destinations', () => { const a=fixture(),b=fixture();expect(a.wrapper.find('[data-chat-context-host]').element).not.toBe(b.wrapper.find('[data-chat-context-host]').element);a.wrapper.unmount();b.wrapper.unmount(); });
});
