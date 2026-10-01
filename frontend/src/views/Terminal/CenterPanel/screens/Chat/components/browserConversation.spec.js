// Which conversation a transcript's browser cards belong to.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref, nextTick } from 'vue';
import {
  normaliseConversationId, provideBrowserConversation, useBrowserConversation,
} from './browserConversation.js';

describe('normaliseConversationId', () => {
  it('passes a real id through, trimmed', () => {
    expect(normaliseConversationId(' 3f2a ')).toBe('3f2a');
  });
  it('a client temp- id is not ready yet (null), so no browser is opened under it', () => {
    expect(normaliseConversationId('temp-1700000000')).toBeNull();
  });
  it('nothing is the default group', () => {
    expect(normaliseConversationId(undefined)).toBe('');
    expect(normaliseConversationId(null)).toBe('');
  });
});

describe('provide / inject', () => {
  const Reader = defineComponent({
    setup() { const id = useBrowserConversation(); return () => h('i', String(id.value)); },
  });
  const Host = (source) => defineComponent({
    setup() { provideBrowserConversation(source); return () => h(Reader); },
  });

  it('a surface that provides nothing yields the default group', () => {
    expect(mount(Reader).text()).toBe('');
  });

  it('follows the provided id, including the temp -> server switch', async () => {
    const id = ref('temp-1');
    const wrapper = mount(Host(id));
    expect(wrapper.text()).toBe('null');
    id.value = 'server-uuid';
    await nextTick();
    expect(wrapper.text()).toBe('server-uuid');
  });

  it('accepts a getter', () => {
    expect(mount(Host(() => 'abc')).text()).toBe('abc');
  });
});
