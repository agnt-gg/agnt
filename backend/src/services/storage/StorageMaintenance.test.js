import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/database/index.js', () => ({ default: { fake: 'db' } }));
vi.mock('../../utils/PathManager.js', () => ({ default: { getDataPath: (name) => `/data/${name}` } }));
vi.mock('../../models/database/dataDirOwnership.js', () => ({ isDataDirOwner: vi.fn() }));
vi.mock('./savedChatSearchCompaction.js', () => ({ compactSavedChatSearchIndex: vi.fn() }));
vi.mock('./freePages.js', () => ({ reclaimFreePages: vi.fn(), databaseSpaceStats: vi.fn() }));

const { isDataDirOwner } = await import('../../models/database/dataDirOwnership.js');
const { compactSavedChatSearchIndex } = await import('./savedChatSearchCompaction.js');
const { reclaimFreePages, databaseSpaceStats } = await import('./freePages.js');
const { runStorageMaintenance, getLastStorageMaintenanceReport } = await import('./StorageMaintenance.js');

const STATS = { pageSize: 4096, pageCount: 1000, freelistCount: 100, autoVacuum: 0, fileBytes: 4096000, freeBytes: 409600, liveBytes: 3686400 };

/**
 * Background upkeep must only ever run in the process that owns the data
 * directory, and a failing step must never escape as an unhandled error.
 */
describe('runStorageMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reclaimFreePages.mockResolvedValue({ status: 'skipped:auto_vacuum=0', pagesFreed: 0, bytesFreed: 0 });
    databaseSpaceStats.mockResolvedValue(STATS);
  });

  it('does nothing at all in a process that does not own the data directory', async () => {
    isDataDirOwner.mockResolvedValue(false);
    expect(await runStorageMaintenance()).toEqual({ status: 'skipped:not-owner' });
    expect(compactSavedChatSearchIndex).not.toHaveBeenCalled();
    expect(reclaimFreePages).not.toHaveBeenCalled();
  });

  it('returns free pages after the compaction, in the same pass', async () => {
    isDataDirOwner.mockResolvedValue(true);
    const order = [];
    compactSavedChatSearchIndex.mockImplementation(async () => { order.push('compact'); return { status: 'complete', reindexed: 3 }; });
    reclaimFreePages.mockImplementation(async () => { order.push('reclaim'); return { status: 'complete', pagesFreed: 256, bytesFreed: 1048576 }; });
    const report = await runStorageMaintenance();
    expect(order).toEqual(['compact', 'reclaim']);
    expect(report.freePages).toEqual({ status: 'complete', pagesFreed: 256, bytesFreed: 1048576 });
  });

  it('runs the saved-chat compaction with the shared handle and the state file in the data directory', async () => {
    isDataDirOwner.mockResolvedValue(true);
    compactSavedChatSearchIndex.mockResolvedValue({ status: 'complete', examined: 0, reindexed: 0, checkedThrough: 5 });
    const report = await runStorageMaintenance();
    expect(compactSavedChatSearchIndex).toHaveBeenCalledWith({ fake: 'db' }, expect.objectContaining({ statePath: '/data/storage-maintenance.json' }));
    expect(report).toMatchObject({ status: 'complete', savedChatSearch: { status: 'complete' }, database: STATS });
    expect(typeof report.finishedAt).toBe('string');
    expect(getLastStorageMaintenanceReport()).toBe(report);
  });

  it('reports a failed step instead of throwing, and still runs the next step', async () => {
    isDataDirOwner.mockResolvedValue(true);
    compactSavedChatSearchIndex.mockRejectedValue(new Error('disk I/O error'));
    const report = await runStorageMaintenance();
    expect(report).toMatchObject({
      status: 'partial',
      savedChatSearch: { status: 'failed', error: 'disk I/O error' },
      freePages: { status: 'skipped:auto_vacuum=0', pagesFreed: 0, bytesFreed: 0 },
    });
    expect(reclaimFreePages).toHaveBeenCalledTimes(1);
  });

  it('still completes the pass when the size read fails', async () => {
    isDataDirOwner.mockResolvedValue(true);
    compactSavedChatSearchIndex.mockResolvedValue({ status: 'complete', reindexed: 0 });
    databaseSpaceStats.mockRejectedValue(new Error('database is locked'));
    const report = await runStorageMaintenance();
    expect(report.status).toBe('complete');
    expect(report.database).toBeUndefined();
    expect(getLastStorageMaintenanceReport()).toBe(report);
  });
});
