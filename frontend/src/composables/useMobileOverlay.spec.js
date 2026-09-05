import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h, ref, nextTick, KeepAlive } from 'vue';
import { useMobileOverlay } from './useMobileOverlay.js';

function fixture(mobile = true) {
  const compact = ref(mobile);
  let overlay;
  const component = defineComponent({ setup() {
    const element = ref(null);
    overlay = useMobileOverlay(compact, () => element.value);
    return () => h('section', [h('button', { class: 'trigger', onClick: () => overlay.open('left') }, 'Open'),
      h('div', { ref: element, tabindex: -1 }, [h('input', { class: 'query' }), h('button', { class: 'last' }, 'Close')])]);
  } });
  const wrapper = mount(component, { attachTo: document.body });
  return { wrapper, compact, get overlay() { return overlay; } };
}

describe('mobile presentation state', () => {
  it('does not open in desktop mode', async () => { const f = fixture(false); await f.overlay.open('left'); expect(f.overlay.active.value).toBeNull(); f.wrapper.unmount(); });
  it('keeps one side active and retains the mounted input', async () => {
    const f = fixture(); await f.wrapper.find('.query').setValue('Research'); const input = f.wrapper.find('.query').element;
    await f.overlay.open('left'); await f.overlay.open('right'); expect(f.overlay.active.value).toBe('right');
    f.overlay.close(); await nextTick(); expect(f.wrapper.find('.query').element).toBe(input); expect(input.value).toBe('Research'); f.wrapper.unmount();
  });
  it('restores trigger focus on Escape without storage mutations', async () => {
    const f = fixture(); const write = vi.spyOn(Storage.prototype, 'setItem'); const trigger = f.wrapper.find('.trigger').element;
    trigger.focus(); await f.wrapper.find('.trigger').trigger('click'); await nextTick();
    expect(document.activeElement).toBe(f.wrapper.find('.query').element);
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await nextTick();
    expect(f.overlay.active.value).toBeNull(); expect(document.activeElement).toBe(trigger); expect(write).not.toHaveBeenCalled(); write.mockRestore(); f.wrapper.unmount();
  });
  it('does not swallow Escape belonging to a teleported child dialog', async () => {
    const f = fixture(); await f.overlay.open('right'); const other = document.createElement('button'); document.body.append(other); other.focus();
    other.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); expect(f.overlay.active.value).toBe('right'); other.remove(); f.wrapper.unmount();
  });
  it('releases the overlay on wide resize without remounting state', async () => {
    const f = fixture(); const input = f.wrapper.find('.query').element; await f.overlay.open('left'); f.compact.value = false; await nextTick();
    expect(f.overlay.active.value).toBeNull(); expect(f.wrapper.find('.query').element).toBe(input); f.wrapper.unmount();
  });
  it('deactivated KeepAlive screens stop owning keyboard events', async () => {
    const shown = ref(true), compact = ref(true); let overlay;
    const child = defineComponent({ setup() { const panel = ref(null); overlay = useMobileOverlay(compact, () => panel.value); return () => h('div', { ref: panel, tabindex: -1 }, 'panel'); } });
    const host = mount(defineComponent({ setup: () => () => h(KeepAlive, null, () => shown.value ? h(child) : h('div', 'other')) }), { attachTo: document.body });
    await overlay.open('right'); shown.value = false; await nextTick(); expect(overlay.active.value).toBeNull(); shown.value = true; await nextTick(); await overlay.open('left'); expect(overlay.active.value).toBe('left'); host.unmount();
  });
});
