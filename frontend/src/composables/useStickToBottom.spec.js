import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { useStickToBottom } from './useStickToBottom.js';

/**
 * jsdom has no layout, so give a real element honest geometry: every child is
 * LINE px tall, scrollTop clamps to [0, scrollHeight - clientHeight] like a
 * browser does. A real element (not a stub) keeps MutationObserver real, which
 * is how the composable notices streamed content.
 */
const LINE = 100;
const VIEWPORT = 400;

function withGeometry(el) {
  let top = 0;
  const max = () => Math.max(0, el.children.length * LINE - VIEWPORT);
  Object.defineProperty(el, 'scrollHeight', { get: () => el.children.length * LINE });
  Object.defineProperty(el, 'clientHeight', { get: () => VIEWPORT });
  Object.defineProperty(el, 'clientWidth', { get: () => 390 });
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v) => {
      top = Math.min(Math.max(0, v), max());
    },
  });
  return el;
}

const flush = async () => {
  await Promise.resolve(); // MutationObserver delivery
  await nextTick();
};

let wrapper;
afterEach(() => wrapper?.unmount());

function setup({ lines = 10, suspended = ref(false) } = {}) {
  let api;
  const elRef = ref(null);
  const Host = defineComponent({
    setup() {
      api = useStickToBottom({ getEl: () => elRef.value, isSuspended: () => suspended.value });
      return () =>
        h(
          'div',
          {
            ref: (node) => {
              if (node && !node.__geo) {
                withGeometry(node);
                node.__geo = true;
              }
              elRef.value = node;
            },
          },
          Array.from({ length: lines }, (_, i) => h('p', { key: i }, `line ${i}`)),
        );
    },
  });
  wrapper = mount(Host, { attachTo: document.body });
  const el = elRef.value;
  const stream = async (n = 1) => {
    for (let i = 0; i < n; i += 1) el.appendChild(document.createElement('p'));
    await flush();
  };
  const userScrollTo = (top) => {
    el.scrollTop = top;
    el.dispatchEvent(new Event('scroll'));
  };
  const bottom = () => el.scrollHeight - el.clientHeight;
  return { api, el, stream, userScrollTo, bottom, suspended };
}

describe('useStickToBottom', () => {
  it('follows streamed content while at the bottom', async () => {
    const { el, stream, bottom } = setup();
    await flush();
    expect(el.scrollTop).toBe(bottom());
    await stream(3);
    expect(el.scrollTop).toBe(bottom());
  });

  it('REGRESSION: one wheel notch up stops the stream pulling the user back', async () => {
    const { el, stream, bottom } = setup();
    await flush();
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -40 }));
    el.scrollTop = bottom() - 40;
    el.dispatchEvent(new Event('scroll'));
    const reading = el.scrollTop;
    await stream(5);
    expect(el.scrollTop).toBe(reading);
  });

  it('releases on the wheel event itself, before the scroll lands', async () => {
    // A token arriving between the wheel and its scroll frame must not pin.
    const { api, el, stream } = setup();
    await flush();
    const before = el.scrollTop;
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -1 }));
    expect(api.following.value).toBe(false);
    await stream(2);
    expect(el.scrollTop).toBe(before);
  });

  it('a small scroll up with no input event (keyboard, momentum) still releases', async () => {
    const { api, stream, userScrollTo, bottom, el } = setup();
    await flush();
    userScrollTo(bottom() - 2);
    expect(api.following.value).toBe(false);
    await stream();
    expect(el.scrollTop).toBe(bottom() - LINE - 2);
  });

  it('scrolling back to the bottom re-engages following', async () => {
    const { api, stream, userScrollTo, bottom, el } = setup();
    await flush();
    userScrollTo(100);
    await stream();
    userScrollTo(bottom());
    expect(api.following.value).toBe(true);
    await stream(2);
    expect(el.scrollTop).toBe(bottom());
  });

  it('follow() (send / scroll-to-bottom button) re-engages from anywhere', async () => {
    const { api, stream, userScrollTo, bottom, el } = setup();
    await flush();
    userScrollTo(0);
    api.follow();
    expect(el.scrollTop).toBe(bottom());
    await stream();
    expect(el.scrollTop).toBe(bottom());
  });

  it('follow({ pin: false }) engages without jumping, then pins on growth', async () => {
    const { api, stream, userScrollTo, bottom, el } = setup();
    await flush();
    userScrollTo(0);
    api.follow({ pin: false });
    expect(el.scrollTop).toBe(0);
    await stream();
    expect(el.scrollTop).toBe(bottom());
  });

  it('a touch drag down the screen releases', async () => {
    const { api, el } = setup();
    await flush();
    const touch = (type, y) => {
      const event = new Event(type);
      event.touches = [{ clientY: y }];
      el.dispatchEvent(event);
    };
    touch('touchstart', 200);
    touch('touchmove', 230);
    expect(api.following.value).toBe(false);
  });

  it('selecting text inside the transcript releases', async () => {
    const { api, el } = setup();
    await flush();
    const range = document.createRange();
    range.selectNodeContents(el.children[0]);
    document.getSelection().removeAllRanges();
    document.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    expect(api.following.value).toBe(false);
    document.getSelection().removeAllRanges();
  });

  it('does not pin while suspended (restore settling)', async () => {
    const { el, stream, suspended } = setup();
    await flush();
    suspended.value = true;
    el.scrollTop = 0;
    await stream(2);
    expect(el.scrollTop).toBe(0);
  });

  it('on resume, following is derived from where the restore landed', async () => {
    const { api, el, suspended, bottom } = setup();
    await flush();
    suspended.value = true;
    el.scrollTop = 100; // restored mid-transcript
    suspended.value = false;
    expect(api.following.value).toBe(false);

    suspended.value = true;
    el.scrollTop = bottom(); // restored to the bottom
    suspended.value = false;
    expect(api.following.value).toBe(true);
  });

  it('a release during suspension wins over a resume that measures "bottom"', async () => {
    // The restore loop aborts on the same wheel event that releases. Whatever
    // order the two listeners run in, the user's release must stick.
    const { api, el, suspended } = setup();
    await flush();
    suspended.value = true;
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }));
    suspended.value = false; // viewport has not moved yet: still at bottom
    expect(api.following.value).toBe(false);
  });

  it('detaches its listeners on unmount', async () => {
    const { api, el, stream } = setup();
    await flush();
    wrapper.unmount();
    wrapper = null;
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }));
    expect(api.following.value).toBe(true);
    const before = el.scrollTop;
    await stream();
    expect(el.scrollTop).toBe(before);
  });
});
