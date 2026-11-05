import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import MobileMessageActions from './MobileMessageActions.vue';
import { messageActions } from '@/services/messageBranching.js';

let wrapper;
let target;
const action = (text) => [...document.querySelectorAll('.mobile-message-actions-sheet button')].find((button) => button.textContent === text);
function pointer(type, options = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerType: 'touch', isPrimary: true, clientX: 20, clientY: 20, ...options });
  target.dispatchEvent(event);
}
const userActions = (enabled = []) => messageActions({ role: 'user', canEdit: true, enabled });
function setup(props = {}) {
  target = document.createElement('div');
  document.body.appendChild(target);
  wrapper = mount(MobileMessageActions, { props: { target, text: 'Original message', actions: userActions(), ...props }, attachTo: document.body });
}
async function longPress() { pointer('pointerdown'); await vi.advanceTimersByTimeAsync(550); }
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
    await longPress();
    expect(action('Copy message')).toBeTruthy();
    action('Edit message').click();
    await flushPromises();
    expect(wrapper.emitted('action')).toEqual([['edit']]);
    expect(action('Edit message')).toBeUndefined();
  });
  it('copies the message text and dismisses the menu', async () => {
    setup(); await longPress();
    action('Copy message').click(); await flushPromises();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Original message');
    expect(action('Copy message')).toBeUndefined();
    expect(wrapper.emitted('action')).toBeUndefined();
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
    setup({ actions: messageActions({ role: 'assistant' }) }); await longPress();
    expect(action('Copy message')).toBeTruthy(); expect(action('Edit message')).toBeUndefined();
  });
  it('offers the same branch actions as the desktop row', async () => {
    setup({ actions: messageActions({ role: 'assistant', enabled: ['regenerate', 'fork', 'delete'] }) }); await longPress();
    action('Regenerate reply').click(); await flushPromises();
    await longPress();
    action('Fork from here').click(); await flushPromises();
    expect(wrapper.emitted('action')).toEqual([['regenerate'], ['fork']]);
  });
  it('asks once more before deleting, then sends a confirmed delete', async () => {
    setup({ actions: userActions(['delete']), deleteCount: 3 }); await longPress();
    action('Delete from here').click(); await flushPromises();
    expect(wrapper.emitted('action')).toBeUndefined();
    action('Tap again to delete 3 messages').click(); await flushPromises();
    expect(wrapper.emitted('action')).toEqual([['delete-confirmed']]);
    expect(action('Copy message')).toBeUndefined();
  });
  it('forgets an unconfirmed delete when the sheet closes', async () => {
    setup({ actions: userActions(['delete']) }); await longPress();
    action('Delete from here').click(); await flushPromises();
    action('Cancel').click(); await flushPromises();
    await longPress();
    expect(action('Delete from here')).toBeTruthy();
  });
  it('removes the pending gesture when unmounted', async () => {
    setup(); pointer('pointerdown'); wrapper.unmount(); wrapper = null;
    await vi.advanceTimersByTimeAsync(550);
    expect(action('Copy message')).toBeUndefined();
  });
});
