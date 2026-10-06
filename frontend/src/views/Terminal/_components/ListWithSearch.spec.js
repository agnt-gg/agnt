import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ListWithSearch from './ListWithSearch.vue';

const tools = [
  { id: 'web_search', title: 'Web Search', description: 'Search Google' },
  { id: 'web_scrape', title: 'Web Scrape', description: 'Read a page' },
  { id: 'send_email', title: 'Send Email', description: 'Mail someone' },
  { id: 'shell', title: 'Shell', description: 'Run a command on the web server' },
];

const mountPicker = (modelValue = []) =>
  mount(ListWithSearch, {
    props: { items: tools, modelValue, labelKey: 'title', placeholder: 'Search tools…', 'onUpdate:modelValue': (ids) => wrapper.setProps({ modelValue: ids }) },
    attachTo: document.body,
  });
let wrapper;
const open = async () => wrapper.find('.lws-input').trigger('focus');
const optionLabels = () => wrapper.findAll('.lws-option-label').map((o) => o.text());
const emitted = () => wrapper.emitted('update:modelValue').map(([ids]) => ids);

describe('ListWithSearch (search and select)', () => {
  it('shows only the selection until the field is used: no long list up front', () => {
    wrapper = mountPicker(['shell']);
    expect(wrapper.findAll('.lws-chip').map((c) => c.text())).toEqual(['Shell']);
    expect(wrapper.find('.lws-results').exists()).toBe(false);
    expect(wrapper.text()).toContain('1 of 4 selected');
    wrapper.unmount();
  });

  it('filters by name and description, names that start with the query first', async () => {
    wrapper = mountPicker();
    await open();
    await wrapper.find('.lws-input').setValue('web');
    expect(optionLabels()).toEqual(['Web Scrape', 'Web Search', 'Shell']); // Shell matches on "web server"
    wrapper.unmount();
  });

  it('toggles with a click and keeps the list open for more', async () => {
    wrapper = mountPicker();
    await open();
    await wrapper.findAll('.lws-option')[1].trigger('click'); // sorted: Send Email, Shell, Web Scrape, Web Search
    expect(emitted()).toEqual([['shell']]);
    expect(wrapper.find('.lws-results').exists()).toBe(true);
    await wrapper.findAll('.lws-option')[1].trigger('click');
    expect(emitted().at(-1)).toEqual([]);
    wrapper.unmount();
  });

  it('works from the keyboard: arrows move, Enter toggles without submitting, Escape closes', async () => {
    wrapper = mountPicker();
    await open();
    const input = wrapper.find('.lws-input');
    await input.trigger('keydown', { key: 'ArrowDown' });
    const enter = await input.trigger('keydown', { key: 'Enter' });
    expect(emitted()).toEqual([['shell']]);
    await input.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.lws-results').exists()).toBe(false);
    wrapper.unmount();
  });

  it('Backspace on an empty search removes the last chip', async () => {
    wrapper = mountPicker(['shell', 'send_email']);
    await wrapper.find('.lws-input').trigger('keydown', { key: 'Backspace' });
    expect(emitted()).toEqual([['shell']]);
    wrapper.unmount();
  });

  it('selects every match, or everything, and clears', async () => {
    wrapper = mountPicker(['shell']);
    await open();
    await wrapper.find('.lws-input').setValue('web sea');
    await wrapper.findAll('.lws-summary-actions button').find((b) => b.text().startsWith('Select')).trigger('click');
    expect(emitted().at(-1)).toEqual(['shell', 'web_search']);
    await wrapper.findAll('.lws-summary-actions button').find((b) => b.text() === 'Clear').trigger('click');
    expect(emitted().at(-1)).toEqual([]);
    wrapper.unmount();
  });

  it('says so when nothing matches', async () => {
    wrapper = mountPicker();
    await open();
    await wrapper.find('.lws-input').setValue('zzz');
    expect(wrapper.find('.lws-empty').text()).toContain('No tools match');
    wrapper.unmount();
  });

  it('ignores selected ids that are no longer in the list instead of showing blank chips', () => {
    wrapper = mountPicker(['deleted_tool', 'shell']);
    expect(wrapper.findAll('.lws-chip')).toHaveLength(1);
    wrapper.unmount();
  });
});
