import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';

const dispatch = vi.fn();
vi.mock('vuex', () => ({ useStore: () => ({ dispatch }) }));

import TryFocusedNote from './TryFocusedNote.vue';

describe('TryFocusedNote', () => {
  let wrapper;
  beforeEach(() => {
    dispatch.mockClear();
    wrapper = mount(TryFocusedNote, { attachTo: document.body });
  });
  afterEach(() => wrapper.unmount());

  const dialog = () => document.body.querySelector('[role="dialog"]');

  it('renders as a modal on <body>, not inside the canvas that clipped it', () => {
    expect(dialog()).not.toBeNull();
    expect(dialog().parentElement.classList.contains('try-focused-scrim')).toBe(true);
    expect(dialog().parentElement.parentElement).toBe(document.body);
    expect(dialog().getAttribute('aria-modal')).toBe('true');
  });

  it('focuses Try Focused, so Enter takes it', () => {
    expect(document.activeElement?.textContent.trim()).toBe('Try Focused');
  });

  it('Try Focused switches the mode and closes', async () => {
    document.body.querySelector('.try-focused-primary').click();
    expect(dispatch).toHaveBeenCalledWith('theme/setUiMode', 'focused');
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  it('takes focus back if something behind it grabs it (the chat composer autofocuses late)', () => {
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement?.textContent.trim()).toBe('Try Focused');
    input.remove();
  });

  it('Not now, Esc (from anywhere) and a click outside all close without switching', async () => {
    document.body.querySelector('.try-focused-quiet').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.querySelector('.try-focused-scrim').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(wrapper.emitted('dismiss')).toHaveLength(3);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('releases focus and keys when it closes (no leaked listeners)', () => {
    wrapper.unmount();
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('dismiss')).toBeUndefined();
    input.remove();
    wrapper = mount(TryFocusedNote, { attachTo: document.body }); // for afterEach
  });

  it('a click inside the dialog does not close it', () => {
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(wrapper.emitted('dismiss')).toBeUndefined();
  });
});
