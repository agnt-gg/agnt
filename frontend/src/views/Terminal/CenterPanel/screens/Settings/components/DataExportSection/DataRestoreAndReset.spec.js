import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';

const svc = vi.hoisted(() => ({
  uploadBackup: vi.fn(), startRestore: vi.fn(), restoreStatus: vi.fn(), discardRestore: vi.fn(),
  resetSummary: vi.fn(), runReset: vi.fn(), clearLocalPreferences: vi.fn(),
}));
vi.mock('@/services/dataBackupService.js', async (importOriginal) => ({ ...(await importOriginal()), ...svc }));
const exportSvc = vi.hoisted(() => ({ requestExport: vi.fn(), startDownload: vi.fn() }));
vi.mock('@/services/dataExportService.js', () => exportSvc);

import DataRestoreSection from './DataRestoreSection.vue';
import DataResetSection from './DataResetSection.vue';

const SUMMARY = {
  exportedAt: '2026-09-20T14:02:00.000Z', filters: {}, complete: true, bytes: 1000,
  categories: [
    { id: 'agents', group: 'work', label: 'Agents', description: 'a', count: 3, restorable: true },
    { id: 'memories', group: 'history', label: 'Agent memories', description: 'm', count: 10, restorable: true },
    { id: 'traces', group: 'history', label: 'Agent traces', description: 't', count: 0, restorable: true },
    { id: 'somethingNew', group: 'history', label: 'somethingNew', description: '', count: 2, restorable: false },
  ],
};
const button = (wrapper, text) => wrapper.findAll('button').find((b) => b.text().includes(text));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  Object.values(svc).forEach((fn) => fn.mockReset());
  Object.values(exportSvc).forEach((fn) => fn.mockReset());
  svc.uploadBackup.mockImplementation(async (_file, { onProgress }) => { onProgress(1); return { id: 'job1', summary: SUMMARY }; });
  svc.discardRestore.mockResolvedValue({});
});
afterEach(() => vi.useRealTimers());

async function chooseFile(wrapper) {
  const input = wrapper.find('input[type="file"]');
  Object.defineProperty(input.element, 'files', { value: [new File(['x'], 'backup.json.gz')], configurable: true });
  await input.trigger('change');
  await flushPromises();
}

describe('Restore from a backup', () => {
  it('shows what the backup holds, pre-selecting everything that can be restored', async () => {
    const wrapper = mount(DataRestoreSection);
    await chooseFile(wrapper);
    expect(svc.uploadBackup).toHaveBeenCalled();
    expect(wrapper.text()).toContain('backup.json.gz');
    const state = Object.fromEntries(wrapper.findAll('.option').map((o) => [o.attributes('data-category'), [o.attributes('aria-checked'), o.attributes('disabled') !== undefined]]));
    expect(state).toEqual({ agents: ['true', false], memories: ['true', false], traces: ['false', true], somethingNew: ['false', true] });
    expect(wrapper.text()).toContain('Made by a newer AGNT');
    expect(wrapper.text()).toContain('Connected accounts and API keys are never in a backup');
  });

  it('warns about a backup that was cut short', async () => {
    svc.uploadBackup.mockResolvedValueOnce({ id: 'job1', summary: { ...SUMMARY, complete: false } });
    const wrapper = mount(DataRestoreSection);
    await chooseFile(wrapper);
    expect(wrapper.text()).toContain('cut short');
  });

  it('restores the chosen parts, follows progress, and reports what happened', async () => {
    svc.startRestore.mockResolvedValue({ status: 'running' });
    svc.restoreStatus
      .mockResolvedValueOnce({ status: 'running', progress: { bytes: 500, totalBytes: 1000 } })
      .mockResolvedValueOnce({ status: 'done', result: { results: { agents: { added: 1, existing: 2, skipped: 0 } }, problems: [] } });
    const wrapper = mount(DataRestoreSection);
    await chooseFile(wrapper);
    await wrapper.find('[data-category="memories"]').trigger('click');
    await button(wrapper, 'Restore').trigger('click');
    await flushPromises();
    expect(svc.startRestore).toHaveBeenCalledWith('job1', ['agents']);
    expect(wrapper.text()).toContain('50%');
    await vi.advanceTimersByTimeAsync(1000);
    await flushPromises();
    expect(wrapper.text()).toContain('Restored 1 item; 2 items were already here');
    expect(button(wrapper, 'Reload AGNT')).toBeTruthy();
  });

  it('shows why an upload was refused and lets you try another file', async () => {
    svc.uploadBackup.mockRejectedValueOnce(new Error('This is not an AGNT backup file.'));
    const wrapper = mount(DataRestoreSection);
    await chooseFile(wrapper);
    expect(wrapper.find('[role="alert"]').text()).toContain('This is not an AGNT backup file.');
    expect(wrapper.find('.drop-zone').exists()).toBe(true);
  });
});

const GROUPS = [
  { id: 'chats', label: 'Chats and outputs', description: '', count: 5 },
  { id: 'memory', label: 'Memory and insights', description: '', count: 7 },
  { id: 'preferences', label: 'Layout and preferences', description: '', count: 1, client: true },
  { id: 'connections', label: 'Connected accounts and API keys', description: '', count: 2, danger: true },
];

describe('Reset', () => {
  beforeEach(() => { svc.resetSummary.mockResolvedValue(GROUPS); });

  it('starts with nothing selected and needs both a choice and the typed word', async () => {
    const wrapper = mount(DataResetSection);
    await flushPromises();
    expect(wrapper.findAll('.option[aria-checked="true"]')).toHaveLength(0);
    const resetButton = () => wrapper.find('.btn-danger');
    expect(resetButton().attributes('disabled')).toBeDefined();
    await wrapper.find('[data-group="memory"]').trigger('click');
    expect(resetButton().attributes('disabled')).toBeDefined();
    await wrapper.find('#reset-confirm').setValue('reset');
    expect(resetButton().attributes('disabled')).toBeDefined();
    await wrapper.find('#reset-confirm').setValue('RESET');
    expect(resetButton().attributes('disabled')).toBeUndefined();
  });

  it('"Select all" never includes disconnecting accounts', async () => {
    const wrapper = mount(DataResetSection);
    await flushPromises();
    await button(wrapper, 'Select all').trigger('click');
    expect(wrapper.find('[data-group="connections"]').attributes('aria-checked')).toBe('false');
    expect(wrapper.findAll('.option[aria-checked="true"]')).toHaveLength(3);
  });

  it('resets the chosen groups, clears browser preferences only when asked, and offers a reload', async () => {
    svc.runReset.mockResolvedValue({ removed: { memory: 7, preferences: 1 }, problems: [] });
    const wrapper = mount(DataResetSection);
    await flushPromises();
    await wrapper.find('[data-group="memory"]').trigger('click');
    await wrapper.find('[data-group="preferences"]').trigger('click');
    await wrapper.find('#reset-confirm').setValue('RESET');
    await wrapper.find('.btn-danger').trigger('click');
    await flushPromises();
    expect(svc.runReset).toHaveBeenCalledWith(['memory', 'preferences'], 'RESET');
    expect(svc.clearLocalPreferences).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Reset complete. Removed 8 items.');
    expect(button(wrapper, 'Reload AGNT')).toBeTruthy();
  });

  it('offers a one-click full backup before resetting', async () => {
    exportSvc.requestExport.mockResolvedValue({ ticket: 't', filename: 'f.json.gz' });
    const wrapper = mount(DataResetSection);
    await flushPromises();
    await button(wrapper, 'Download a full backup').trigger('click');
    await flushPromises();
    expect(exportSvc.requestExport).toHaveBeenCalledWith({ categories: 'all', compress: true });
    expect(exportSvc.startDownload).toHaveBeenCalledWith('t', 'f.json.gz');
  });
});

describe('clearing browser preferences', () => {
  it('keeps you signed in', async () => {
    const { clearLocalPreferences: realClear } = await vi.importActual('@/services/dataBackupService.js');
    const store = new Map([['token', 'jwt'], ['signedLicense', 'lic'], ['theme', 'light'], ['nav', 'x']]);
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), clear: () => store.clear() };
    realClear(storage);
    expect(Object.fromEntries(store)).toEqual({ token: 'jwt', signedLicense: 'lic' });
  });
});
