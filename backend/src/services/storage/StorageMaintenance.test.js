import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/database/index.js', () => ({ default: { fake: 'db' } }));
vi.mock('../../utils/PathManager.js', () => ({ default: { getDataPath: (name) => `/data/${name}` } }));
vi.mock('../../models/database/dataDirOwnership.js', () => ({ isDataDirOwner: vi.fn() }));
vi.mock('./savedChatSearchCompaction.js', () => ({ compactSavedChatSearchIndex: vi.fn() }));

const { isDataDirOwner } = await import('../../models/database/dataDirOwnership.js');
const { compactSavedChatSearchIndex } = await import('./savedChatSearchCompaction.js');
const { runStorageMaintenance } = await import('./StorageMaintenance.js');

/**
 * Background upkeep must only ever run in the process that owns the data
 * directory, and a failing step must never escape as an unhandled error.
 */
describe('runStorageMaintenance', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does nothing at all in a process that does not own the data directory', async () => {
    isDataDirOwner.mockResolvedValue(false);
    expect(await runStorageMaintenance()).toEqual({ status: 'skipped:not-owner' });
    expect(compactSavedChatSearchIndex).not.toHaveBeenCalled();
  });

  it('runs the saved-chat compaction with the shared handle and the state file in the data directory', async () => {
    isDataDirOwner.mockResolvedValue(true);
    compactSavedChatSearchIndex.mockResolvedValue({ status: 'complete', examined: 0, reindexed: 0, checkedThrough: 5 });
    const report = await runStorageMaintenance();
    expect(compactSavedChatSearchIndex).toHaveBeenCalledWith({ fake: 'db' }, expect.objectContaining({ statePath: '/data/storage-maintenance.json' }));
    expect(report).toMatchObject({ status: 'complete', savedChatSearch: { status: 'complete' } });
  });

  it('reports a failed step instead of throwing', async () => {
    isDataDirOwner.mockResolvedValue(true);
    compactSavedChatSearchIndex.mockRejectedValue(new Error('disk I/O error'));
    const report = await runStorageMaintenance();
    expect(report).toEqual({ status: 'partial', savedChatSearch: { status: 'failed', error: 'disk I/O error' } });
  });
});
