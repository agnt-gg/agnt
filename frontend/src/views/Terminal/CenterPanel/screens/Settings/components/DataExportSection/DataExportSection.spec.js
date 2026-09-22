/**
 * Settings → Backup & Export.
 *
 * This section was a placeholder that said "will be implemented here". What
 * matters now: everything is selectable (and selected by default), the
 * selection and dates reach the server exactly, the download is handed to the
 * browser's download manager (never buffered in the page), and a slow count
 * request can never overwrite a newer one.
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
  { id: 'memories', label: 'Agent memories', description: 'm', count: 98772 },
  { id: 'conversations', label: 'Conversations', description: 'c', count: 1 },
  { id: 'traces', label: 'Agent traces', description: 't', count: 0 },
];

const withCounts = (counts) => CATEGORIES.map((c) => ({ ...c, count: counts[c.id] ?? c.count }));

async function mountSection() {
  const wrapper = mount(DataExportSection);
  await flushPromises();
  return wrapper;
}

const buttonByText = (wrapper, text) => wrapper.findAll('button').find((b) => b.text().includes(text));

beforeEach(() => {
  fetchExportCategories.mockReset().mockResolvedValue(CATEGORIES);
  requestExport.mockReset().mockResolvedValue({ success: true, ticket: 'tkt', filename: 'agnt-export-all-2026-09-22.json' });
  startDownload.mockReset();
});

describe('DataExportSection', () => {
  it('lists every category with its count, all selected by default', async () => {
    const wrapper = await mountSection();
    const rows = wrapper.findAll('.category-row');
    expect(rows.map((r) => r.attributes('data-category'))).toEqual(['memories', 'conversations', 'traces']);
    expect(rows[0].text()).toContain((98772).toLocaleString());
    expect(rows[1].text()).toContain('1 item');
    expect(rows[2].text()).toContain('0 items');
    expect(wrapper.findAll('.category-check').every((c) => c.element.checked)).toBe(true);
    expect(wrapper.text()).toContain('3 of 3 categories selected');
    expect(wrapper.text()).not.toContain('will be implemented');
  });

  it('exports only the chosen categories, in canonical order, with dates and compression', async () => {
    const wrapper = await mountSection();
    await buttonByText(wrapper, 'Clear').trigger('click');
    await wrapper.find('[data-category="traces"] .category-check').setValue(true);
    await wrapper.find('[data-category="memories"] .category-check').setValue(true);
    const [from, to] = wrapper.findAll('.date-input');
    await from.setValue('2026-09-01');
    await to.setValue('2026-09-30');
    await wrapper.find('.toggle-switch input').setValue(true);
    await flushPromises();

    await buttonByText(wrapper, 'Export selected').trigger('click');
    await flushPromises();

    expect(requestExport).toHaveBeenCalledWith({
      categories: ['memories', 'traces'], since: '2026-09-01', until: '2026-09-30', compress: true,
    });
    expect(startDownload).toHaveBeenCalledWith('tkt', 'agnt-export-all-2026-09-22.json');
    expect(wrapper.text()).toContain('Your download has started');
  });

  it('"Export everything" ignores the current selection', async () => {
    const wrapper = await mountSection();
    await buttonByText(wrapper, 'Clear').trigger('click');
    await buttonByText(wrapper, 'Export everything').trigger('click');
    await flushPromises();
    expect(requestExport.mock.calls[0][0].categories).toEqual(['memories', 'conversations', 'traces']);
  });

  it('cannot export an empty selection', async () => {
    const wrapper = await mountSection();
    await buttonByText(wrapper, 'Clear').trigger('click');
    const exportSelected = buttonByText(wrapper, 'Export selected');
    expect(exportSelected.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Select at least one category');
  });

  it('recounts for the date range and keeps the user’s selection', async () => {
    const wrapper = await mountSection();
    await wrapper.find('[data-category="conversations"] .category-check').setValue(false);
    fetchExportCategories.mockResolvedValueOnce(withCounts({ memories: 12 }));
    await wrapper.findAll('.date-input')[0].setValue('2026-09-01');
    await flushPromises();

    expect(fetchExportCategories).toHaveBeenLastCalledWith({ since: '2026-09-01', until: '' });
    expect(wrapper.find('[data-category="memories"]').text()).toContain('12 items');
    expect(wrapper.find('[data-category="conversations"] .category-check').element.checked).toBe(false);
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
    expect(wrapper.find('[data-category="memories"]').text()).toContain('2 items');
  });

  it('shows a server error from the export and does not start a download', async () => {
    requestExport.mockRejectedValueOnce(new Error('since must not be after until'));
    const wrapper = await mountSection();
    await buttonByText(wrapper, 'Export selected').trigger('click');
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
    expect(wrapper.findAll('.category-row')).toHaveLength(3);
  });
});
