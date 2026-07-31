import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import CustomSelect from './CustomSelect.vue';

const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
];

/**
 * Mount with the trigger's bounding rect pinned, so updatePosition() computes
 * against a known geometry instead of jsdom's all-zero rects.
 */
function mountAt(rect) {
  const wrapper = mount(CustomSelect, {
    props: { options: OPTIONS, modelValue: 'a' },
    global: { stubs: { teleport: true }, directives: { tooltip: {} } },
  });
  wrapper.vm.$refs.selectContainer.getBoundingClientRect = () => ({
    top: rect.top,
    bottom: rect.top + rect.height,
    left: rect.left,
    right: rect.left + rect.width,
    width: rect.width,
    height: rect.height,
  });
  return wrapper;
}

// jsdom defaults: window.innerWidth 1024, innerHeight 768.
describe('CustomSelect viewport-aware placement', () => {
  it('opens downward with the configured max height when there is room', async () => {
    const wrapper = mountAt({ top: 100, left: 100, width: 200, height: 32 });
    wrapper.vm.isOpen = true;
    wrapper.vm.updatePosition();

    const style = wrapper.vm.dropdownStyle;
    expect(style.top).toBe('132px');
    expect(style.bottom).toBe('auto');
    expect(style.maxHeight).toBe('300px');
  });

  it('flips upward when the trigger sits near the bottom edge', async () => {
    const wrapper = mountAt({ top: 700, left: 100, width: 200, height: 32 });
    wrapper.vm.isOpen = true;
    wrapper.vm.updatePosition();

    const style = wrapper.vm.dropdownStyle;
    // space below = 768 - 732 - 8 = 28px (< usable); space above = 692px.
    expect(style.top).toBe('auto');
    expect(style.bottom).toBe(`${768 - 700}px`);
    expect(style.maxHeight).toBe('300px');
  });

  it('shrinks below the configured max height instead of bleeding off the bottom', async () => {
    const wrapper = mountAt({ top: 550, left: 100, width: 200, height: 32 });
    wrapper.vm.isOpen = true;
    wrapper.vm.updatePosition();

    const style = wrapper.vm.dropdownStyle;
    // space below = 768 - 582 - 8 = 178px: enough to stay open-down, but the
    // 300px ceiling must shrink to fit.
    expect(style.top).toBe('582px');
    expect(style.maxHeight).toBe('178px');
  });

  it('clamps width to the room right of the anchor and floors the left edge', async () => {
    const wrapper = mountAt({ top: 100, left: 900, width: 100, height: 32 });
    wrapper.vm.isOpen = true;
    wrapper.vm.updatePosition();

    const style = wrapper.vm.dropdownStyle;
    expect(style.left).toBe('900px');
    expect(style.maxWidth).toBe(`${1024 - 900 - 8}px`);

    const clipped = mountAt({ top: 100, left: -20, width: 100, height: 32 });
    clipped.vm.isOpen = true;
    clipped.vm.updatePosition();
    expect(clipped.vm.dropdownStyle.left).toBe('8px');
  });
});
