/**
 * Settings → Backup & Restore → Back up.
 *
 * What is pinned: everything is shown and selected on first load (never an empty
 * list until "Select all"), the cards are grouped into your work and history,
 * the cards are real checkboxes that are not <label>s (the global label rules
 * are what made them overflow and overlap), the selection and dates reach the
 * server exactly, the download goes to the browser's download manager, and a
 * slow count request can never overwrite a newer one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const fetchExportCategories = vi.fn();
const requestExport = vi.fn();
const startDownload = vi.fn();

vi.mock('@/services/dataExportService.js', () => ({
  fetchExportCategories: (...a) => fetchExportCategories(...a),
  requestExport: (...a) => requestExport(...a),
  startDownload: (...a) => startDownload(...a),
}));

import DataExportSection from './DataExportSection.vue';

const CATEGORIES = [
  { id: 'agents', group: 'work', label: 'Agents', description: 'a', count: 99 },
  { id: 'memories', group: 'history', label: 'Agent memories', description: 'm', count: 98772 },
  { id: 'conversations', group: 'history', label: 'Conversations', description: 'c', count: 1 },
  { id: 'traces', group: 'history', label: 'Agent traces', description: 't', count: 0 },
];

const withCounts = (counts) => CATEGORIES.map((c) => ({ ...c, count: counts[c.id] ?? c.count }));

async function mountSection() {
  const wrapper = mount(DataExportSection, { global: { directives: { tooltip: {} } } });
  await flushPromises();
  return wrapper;
}

const buttonByText = (wrapper, text) => wrapper.findAll('button').find((b) => b.text().includes(text));
const card = (wrapper, id) => wrapper.find(`[data-category="${id}"]`);
const isChecked = (wrapper, id) => card(wrapper, id).attributes('aria-checked') === 'true';

beforeEach(() => {
  fetchExportCategories.mockReset().mockResolvedValue(CATEGORIES);
  requestExport.mockReset().mockResolvedValue({ success: true, ticket: 'tkt', filename: 'agnt-export-all-2026-09-22.json' });
  startDownload.mockReset();
});

describe('DataExportSection', () => {
  it('shows placeholders while loading, never an empty panel', async () => {
    let resolve;
    fetchExportCategories.mockReset().mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const wrapper = mount(DataExportSection, { global: { directives: { tooltip: {} } } });
    await flushPromises();
    expect(wrapper.findAll('.skeleton').length).toBeGreaterThan(0);
    resolve(CATEGORIES);
    await flushPromises();
    expect(wrapper.findAll('.skeleton')).toHaveLength(0);
    expect(wrapper.findAll('.option')).toHaveLength(4);
  });

  it('lists every category with its count, grouped, all selected on first load', async () => {
    const wrapper = await mountSection();
    const groups = wrapper.findAll('.option-group');
    expect(groups.map((g) => g.find('.option-group-title').text())).toEqual(['Your work99 items', 'History98,773 items']);
    expect(wrapper.findAll('.option').map((r) => r.attributes('data-category'))).toEqual(['agents', 'memories', 'conversations', 'traces']);
    expect(card(wrapper, 'memories').text()).toContain((98772).toLocaleString());
    expect(card(wrapper, 'conversations').text()).toContain('1 item');
    expect(card(wrapper, 'traces').text()).toContain('0 items');
    expect(CATEGORIES.every((c) => isChecked(wrapper, c.id))).toBe(true);
    expect(wrapper.text()).toContain('4 of 4 selected');
  });

  it('uses real, focusable checkbox buttons, never <label> cards', async () => {
    const wrapper = await mountSection();
    for (const option of wrapper.findAll('.option')) {
      expect(option.element.tagName).toBe('BUTTON');
      expect(option.attributes('role')).toBe('checkbox');
    }
    expect(wrapper.find('label.option').exists()).toBe(false);
  });

  it('backs up only the chosen categories, in canonical order, with dates and compression', async () => {
    const wrapper = await mountSection();
    await buttonByText(wrapper, 'Clear').trigger('click');
    await card(wrapper, 'traces').trigger('click');
    await card(wrapper, 'memories').trigger('click');
    const [from, to] = wrapper.findAll('.date-input');
    await from.setValue('2026-09-01');
    await to.setValue('2026-09-30');
    await wrapper.find('.switch input').setValue(false);
    await flushPromises();

    await buttonByText(wrapper, 'Download backup').trigger('click');
    await flushPromises();

    expect(requestExport).toHaveBeenCalledWith({ categories: ['memories', 'traces'], since: '2026-09-01', until: '2026-09-30', compress: false });
    expect(startDownload).toHaveBeenCalledWith('tkt', 'agnt-export-all-2026-09-22.json');
    expect(wrapper.text()).toContain('Download started');
  });

  it('compresses by default', async () => {
    const wrapper = await mountSection();
    await buttonByText(wrapper, 'Download backup').trigger('click');
    await flushPromises();
    expect(requestExport.mock.calls[0][0].compress).toBe(true);
  });

  it('"Back up everything" ignores the current selection', async () => {
    const wrapper = await mountSection();
    await buttonByText(wrapper, 'Clear').trigger('click');
    await buttonByText(wrapper, 'Back up everything').trigger('click');
    await flushPromises();
    expect(requestExport.mock.calls[0][0].categories).toEqual(['agents', 'memories', 'conversations', 'traces']);
  });

  it('cannot back up an empty selection', async () => {
    const wrapper = await mountSection();
    await buttonByText(wrapper, 'Clear').trigger('click');
    expect(buttonByText(wrapper, 'Download backup').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Select at least one thing');
  });

  it('recounts for the date range and keeps the user’s selection', async () => {
    const wrapper = await mountSection();
    await card(wrapper, 'conversations').trigger('click');
    fetchExportCategories.mockResolvedValueOnce(withCounts({ memories: 12 }));
    await wrapper.findAll('.date-input')[0].setValue('2026-09-01');
    await flushPromises();

    expect(fetchExportCategories).toHaveBeenLastCalledWith({ since: '2026-09-01', until: '' });
    expect(card(wrapper, 'memories').text()).toContain('12 items');
    expect(isChecked(wrapper, 'conversations')).toBe(false);
    expect(isChecked(wrapper, 'memories')).toBe(true);
  });

  it('never lets a slower, older count response overwrite a newer one', async () => {
    const wrapper = await mountSection();
    let resolveSlow;
    fetchExportCategories
      .mockImplementationOnce(() => new Promise((r) => { resolveSlow = r; }))
      .mockResolvedValueOnce(withCounts({ memories: 2 }));
    const from = wrapper.findAll('.date-input')[0];
    await from.setValue('2026-01-01');
    await from.setValue('2026-09-01');
    await flushPromises();
    resolveSlow(withCounts({ memories: 999 }));
    await flushPromises();
    expect(card(wrapper, 'memories').text()).toContain('2 items');
  });

  it('shows a server error and does not start a download', async () => {
    requestExport.mockRejectedValueOnce(new Error('since must not be after until'));
    const wrapper = await mountSection();
    await buttonByText(wrapper, 'Download backup').trigger('click');
    await flushPromises();
    expect(startDownload).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('since must not be after until');
  });

  it('offers a retry when the categories cannot be loaded', async () => {
    fetchExportCategories.mockReset().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(CATEGORIES);
    const wrapper = await mountSection();
    expect(wrapper.find('[role="alert"]').text()).toContain('offline');
    await buttonByText(wrapper, 'Try again').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.option')).toHaveLength(4);
  });
});
