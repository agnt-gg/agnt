import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import MobileMessageActions from './MobileMessageActions.vue';

let wrapper;
let target;
const action = (text) => [...document.querySelectorAll('.mobile-message-actions-sheet button')].find((button) => button.textContent === text);
function pointer(type, options = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerType: 'touch', isPrimary: true, clientX: 20, clientY: 20, ...options });
  target.dispatchEvent(event);
}
function setup(props = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  wrapper = mount(MobileMessageActions, { props: { target, text: 'Original message', canEdit: true, ...props }, attachTo: document.body });
}
beforeEach(() => {
  vi.useFakeTimers();
  window.innerWidth = 390;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockResolvedValue() } });
});
afterEach(() => { wrapper?.unmount(); document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('mobile message actions', () => {
  it('shows nothing for a tap, then copy/edit after a long press', async () => {
    setup();
    pointer('pointerdown'); pointer('pointerup');
    await vi.advanceTimersByTimeAsync(550);
    expect(action('Copy message')).toBeUndefined();
    pointer('pointerdown');
    await vi.advanceTimersByTimeAsync(550);
    expect(action('Copy message')).toBeTruthy();
    action('Edit message').click();
    await flushPromises();
    expect(wrapper.emitted('edit')).toHaveLength(1);
    expect(action('Edit message')).toBeUndefined();
  });
  it('copies the message text and dismisses the menu', async () => {
    setup(); pointer('pointerdown'); await vi.advanceTimersByTimeAsync(550);
    action('Copy message').click(); await flushPromises();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Original message');
    expect(action('Copy message')).toBeUndefined();
  });
  it.each(['pointermove', 'pointercancel', 'scroll'])('does not open while scrolling or cancelling: %s', async (event) => {
    setup(); pointer('pointerdown');
    if (event === 'scroll') window.dispatchEvent(new Event('scroll'));
    else pointer(event, { clientY: 80 });
    await vi.advanceTimersByTimeAsync(550);
    expect(action('Copy message')).toBeUndefined();
  });
  it('does not intercept desktop mouse presses', async () => {
    setup(); window.innerWidth = 1280;
    pointer('pointerdown', { pointerType: 'mouse' }); await vi.advanceTimersByTimeAsync(550);
    expect(action('Copy message')).toBeUndefined();
  });
  it('does not offer edit for a non-editable reply', async () => {
    setup({ canEdit: false }); pointer('pointerdown'); await vi.advanceTimersByTimeAsync(550);
    expect(action('Copy message')).toBeTruthy(); expect(action('Edit message')).toBeUndefined();
  });
  it('removes the pending gesture when unmounted', async () => {
    setup(); pointer('pointerdown'); wrapper.unmount(); wrapper = null;
    await vi.advanceTimersByTimeAsync(550);
    expect(action('Copy message')).toBeUndefined();
  });
});
