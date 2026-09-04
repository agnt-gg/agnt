import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import BrowserToolbar from './BrowserToolbar.vue';

describe('BrowserToolbar', () => {
  it('turns a hostname into an HTTPS navigation', async () => {
    const wrapper = mount(BrowserToolbar, { props: { url: 'about:blank' } });
    const input = wrapper.get('input[aria-label="Address"]');

    await input.setValue('x.com');
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('navigate')).toEqual([['https://x.com']]);
  });

  it.each([
    'http://localhost:3000/path',
    'https://agnt.gg/security',
  ])('keeps an explicit web address intact: %s', async (url) => {
    const wrapper = mount(BrowserToolbar, { props: { url: 'about:blank' } });
    await wrapper.get('input[aria-label="Address"]').setValue(url);
    await wrapper.get('form').trigger('submit');

    expect(wrapper.emitted('navigate')).toEqual([[url]]);
  });

  it('exposes ordinary browser controls with honest disabled state', () => {
    const wrapper = mount(BrowserToolbar, {
      props: { url: 'https://agnt.gg', canGoBack: true, canGoForward: false },
    });

    expect(wrapper.get('button[aria-label="Back"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('button[aria-label="Forward"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('button[aria-label="Reload"]').attributes('disabled')).toBeUndefined();
  });
});
