// Inside AGNT One the message box's buttons say what they do; Studio keeps its icons.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ChatInputBar from './ChatInputBar.vue';
import { PLAIN_WORDS_KEY } from '@/composables/plainWords.js';

const mountBar = (props, plain) => mount(ChatInputBar, {
  props: { modelValue: '', compact: false, showAttachments: true, ...props },
  global: { provide: plain ? { [PLAIN_WORDS_KEY]: true } : {}, directives: { tooltip: {}, 'click-outside': {} }, stubs: { Tooltip: { template: '<span><slot /></span>' } } },
});

describe('the message box in plain words', () => {
  it('labels Attach a file and Stop inside AGNT One', () => {
    expect(mountBar({}, true).find('.chat-attach-btn').text()).toBe('Attach a file');
    expect(mountBar({ isStreaming: true }, true).find('.chat-stop-btn').text()).toBe('Stop');
  });
  it('keeps icon-only buttons elsewhere', () => {
    expect(mountBar({}, false).find('.chat-attach-btn').text()).toBe('');
  });
});
