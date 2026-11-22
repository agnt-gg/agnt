import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { usePlainWords, PLAIN_WORDS_KEY } from './plainWords.js';

const Probe = defineComponent({
  props: { type: String },
  setup(props) {
    const words = usePlainWords();
    return () => h('span', (words(props.type) || [null, 'builder'])[1]);
  },
});

describe('plain words, where the shell asks for them', () => {
  it('One’s shell gets assistants and automations; anywhere else keeps the builder’s names', () => {
    const inOne = (type) => mount(Probe, { props: { type }, global: { provide: { [PLAIN_WORDS_KEY]: true } } }).text();
    expect(['agent', 'workflow', 'tool', 'skill', 'widget', 'plugin'].map(inOne)).toEqual(['assistants', 'automations', 'actions', 'playbooks', 'dashboard cards', 'add-ons']);
    expect(inOne('Agent')).toBe('assistants');
    expect(inOne('mystery')).toBe('builder');
    expect(mount(Probe, { props: { type: 'agent' } }).text()).toBe('builder');
  });
});
