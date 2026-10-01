import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';

const dispatch = vi.fn();
vi.mock('vuex', () => ({ useStore: () => ({ dispatch }) }));

import TrySimpleNote from './TrySimpleNote.vue';

describe('TrySimpleNote', () => {
  let wrapper;
  beforeEach(() => {
    dispatch.mockClear();
    wrapper = mount(TrySimpleNote, { attachTo: document.body });
  });
  afterEach(() => wrapper.unmount());

  const dialog = () => document.body.querySelector('[role="dialog"]');

  it('renders as a modal on <body>, not inside the canvas that clipped it', () => {
    expect(dialog()).not.toBeNull();
    expect(dialog().parentElement.classList.contains('try-simple-scrim')).toBe(true);
    expect(dialog().parentElement.parentElement).toBe(document.body);
    expect(dialog().getAttribute('aria-modal')).toBe('true');
  });

  it('focuses Try Simple, so Enter takes it', () => {
    expect(document.activeElement?.textContent.trim()).toBe('Try Simple');
  });

  it('Try Simple switches the mode and closes', async () => {
    document.body.querySelector('.try-simple-primary').click();
    expect(dispatch).toHaveBeenCalledWith('theme/setUiMode', 'simple');
    expect(wrapper.emitted('dismiss')).toHaveLength(1);
  });

  it('takes focus back if something behind it grabs it (the chat composer autofocuses late)', () => {
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement?.textContent.trim()).toBe('Try Simple');
    input.remove();
  });

  it('Not now, Esc (from anywhere) and a click outside all close without switching', async () => {
    document.body.querySelector('.try-simple-quiet').click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.querySelector('.try-simple-scrim').dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
    wrapper = mount(TrySimpleNote, { attachTo: document.body }); // for afterEach
  });

  it('a click inside the dialog does not close it', () => {
    dialog().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(wrapper.emitted('dismiss')).toBeUndefined();
  });
});
