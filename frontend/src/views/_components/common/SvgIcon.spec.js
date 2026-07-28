import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import SvgIcon from './SvgIcon.vue';

// SvgIcon used to fetch each icon over the network. It now pre-loads every file
// under src/assets/icons at build time via import.meta.glob and resolves
// synchronously, so these tests describe the glob contract: no network, a
// gradient <defs> injected into the shipped markup, and a puzzle-piece fallback
// for names we do not ship a file for.
describe('SvgIcon', () => {
  let wrapper;
  let consoleErrorSpy;

  beforeEach(() => {
    global.fetch = vi.fn();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    consoleErrorSpy.mockRestore();
  });

  it('initializes with correct props', () => {
    wrapper = shallowMount(SvgIcon, { props: { name: 'agent' } });
    expect(wrapper.props('name')).toBe('agent');
  });

  it('resolves a shipped icon synchronously, with no network request', () => {
    wrapper = shallowMount(SvgIcon, { props: { name: 'agent' } });

    // Available on first render — no await, no flushPromises.
    expect(wrapper.vm.svgContent).toContain('<svg');
    expect(wrapper.vm.svgContent).toContain('viewBox');
    expect(wrapper.html()).toContain('<svg');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('injects the gradient defs into the resolved markup', () => {
    wrapper = shallowMount(SvgIcon, { props: { name: 'agent' } });

    expect(wrapper.vm.svgContent).toContain('<defs>');
    expect(wrapper.vm.svgContent).toContain('id="SVG-Gradient"');
    expect(wrapper.vm.svgContent).toContain('id="SVG-Gradient-Dark"');
    // The defs must sit immediately after the opening <svg> tag.
    expect(wrapper.vm.svgContent).toMatch(/<svg[^>]*><defs>/i);
  });

  it('falls back to the puzzle-piece icon for an unknown name', () => {
    const known = shallowMount(SvgIcon, { props: { name: 'puzzle-piece' } });
    wrapper = shallowMount(SvgIcon, { props: { name: 'not-a-real-icon-name' } });

    expect(wrapper.vm.svgContent).not.toBe('');
    expect(wrapper.vm.svgContent).toBe(known.vm.svgContent);
    known.unmount();
  });

  it('updates SVG when name prop changes', async () => {
    wrapper = shallowMount(SvgIcon, { props: { name: 'agent' } });
    const first = wrapper.vm.svgContent;

    await wrapper.setProps({ name: 'api' });

    expect(wrapper.vm.svgContent).toContain('<svg');
    expect(wrapper.vm.svgContent).not.toBe(first);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
