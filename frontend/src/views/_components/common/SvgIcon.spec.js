import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { shallowMount, flushPromises } from '@vue/test-utils';
import SvgIcon from './SvgIcon.vue';

describe('SvgIcon', () => {
  let wrapper;
  let consoleErrorSpy;

  beforeEach(() => {
    global.fetch = vi.fn();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('initializes with correct props', () => {
    wrapper = shallowMount(SvgIcon, {
      props: {
        name: 'test-icon',
      },
    });
    expect(wrapper.props('name')).toBe('test-icon');
  });

  it('calls loadSvg method and sets svgContent', async () => {
    const mockSvgContent = '<svg><path d="test"/></svg>';
    global.fetch.mockResolvedValueOnce({
      ok: true,
      text: () => Promise.resolve(mockSvgContent),
    });

    wrapper = shallowMount(SvgIcon, {
      props: {
        name: 'test-icon',
      },
    });

    await flushPromises();

    expect(global.fetch).toHaveBeenCalledWith('/src/assets/icons/test-icon.svg');
    expect(wrapper.vm.svgContent).toContain('<path d="test"');
  });

  it('handles fetch errors gracefully', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Fetch failed'));

    wrapper = shallowMount(SvgIcon, {
      props: {
        name: 'test-icon',
      },
    });

    await flushPromises();

    // Component shows fallback SVG content on error (with gradient definitions)
    expect(wrapper.vm.svgContent).toContain('<svg>');
    // The component handles errors gracefully by showing fallback content
  });

  it('updates SVG when name prop changes', async () => {
    const mockSvgContent1 = '<svg><path d="test1"/></svg>';
    const mockSvgContent2 = '<svg><path d="test2"/></svg>';

    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSvgContent1),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockSvgContent2),
      });

    wrapper = shallowMount(SvgIcon, {
      props: {
        name: 'test-icon-1',
      },
    });

    await flushPromises();
    expect(wrapper.vm.svgContent).toContain('<path d="test1"');

    await wrapper.setProps({ name: 'test-icon-2' });
    await flushPromises();

    expect(wrapper.vm.svgContent).toContain('<path d="test2"');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
