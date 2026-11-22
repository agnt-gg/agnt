// Inside AGNT One the automation's on/off button says Turn on / Turn off; Studio keeps its icon.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import WorkflowEngine from './WorkflowEngine.vue';
import { PLAIN_WORDS_KEY } from '@/composables/plainWords.js';

const mountEngine = (status, plain) => mount(WorkflowEngine, {
  props: { edges: [], workflowStatus: status },
  global: { provide: plain ? { [PLAIN_WORDS_KEY]: true } : {}, stubs: { Tooltip: { template: '<span><slot /></span>' } } },
});

describe('the automation on/off button', () => {
  it('says Turn on, Turn off, Starting… inside AGNT One', () => {
    expect(mountEngine('stopped', true).text()).toBe('Turn on');
    expect(mountEngine('listening', true).text()).toBe('Turn off');
    expect(mountEngine('queued', true).text()).toBe('Starting…');
  });
  it('is an icon in Studio', () => {
    expect(mountEngine('stopped', false).text()).toBe('');
  });
});
