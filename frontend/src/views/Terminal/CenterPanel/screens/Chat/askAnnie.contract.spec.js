/**
 * "Put this sentence in the composer" (agnt:ask-annie, send: false) must
 * actually put it there.
 *
 * Found on a fresh account in AGNT One: tapping a getting-started step did
 * nothing, and the same was true of every caller (FocusedShell's ask, the
 * Jump palette's "Ask Annie", the journey's usePrompt). Chat's handler did
 * `baseScreenRef.value.currentUserInput = text`, but BaseScreen uses
 * expose(), so its template ref is the expose proxy: the assignment landed on
 * a plain object and the composer never changed. No error, no warning.
 *
 * The first test pins the Vue behaviour the bug came from; the others pin
 * the fix: one exposed setter, and no assignment through a component ref.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const CHAT = readFileSync(join(DIR, 'Chat.vue'), 'utf8');
const BASE = readFileSync(join(DIR, '../../BaseScreen.vue'), 'utf8');

describe('Ask Annie fills the composer', () => {
  it('the mechanism: through an expose() ref, assigning state is a silent no-op; an exposed setter works', async () => {
    const Composer = defineComponent({
      setup(_, { expose }) {
        const currentUserInput = ref('');
        const setUserInput = (text) => { currentUserInput.value = text; };
        expose({ setUserInput });
        return { currentUserInput };
      },
      render() { return h('textarea', { value: this.currentUserInput }); },
    });
    const composer = ref(null);
    const w = mount(defineComponent({ render: () => h(Composer, { ref: composer }) }));
    composer.value.currentUserInput = 'lost';
    await nextTick();
    expect(w.find('textarea').element.value).toBe('');
    composer.value.setUserInput('Connect my Google account');
    await nextTick();
    expect(w.find('textarea').element.value).toBe('Connect my Google account');
    w.unmount();
  });

  it('BaseScreen exposes setUserInput', () => {
    const block = BASE.slice(BASE.indexOf('expose({'), BASE.indexOf('});', BASE.indexOf('expose({')));
    expect(block).toMatch(/\bsetUserInput\b/);
    expect(BASE).toMatch(/const setUserInput = \(text\) => \{\s*currentUserInput\.value =/);
  });

  it('Chat fills the composer through it, and assigns nothing through the ref', () => {
    // To the handler's own closing line (`e.detail || {};` would end it early).
    const start = CHAT.indexOf('const handleAskAnnie');
    const handler = CHAT.slice(start, CHAT.indexOf('\n    };', start));
    expect(handler).toMatch(/send && hasConnectedAIProvider/); // anti-vacuity: the whole body
    expect(handler).toMatch(/baseScreenRef\.value\.setUserInput\(text\)/);
    expect(CHAT).not.toMatch(/baseScreenRef\.value\??\.\w+\s*=(?!=)/);
  });
});
