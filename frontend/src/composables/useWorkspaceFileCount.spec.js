import { describe, it, expect, vi, beforeEach } from 'vitest';

const getTree = vi.fn();
vi.mock('@/services/fileSystemService.js', () => ({ getTree: (...args) => getTree(...args) }));
const { useWorkspaceFileCount, reportWorkspaceRootCount, _resetWorkspaceFileCount } = await import('./useWorkspaceFileCount.js');

beforeEach(() => {
  _resetWorkspaceFileCount();
  getTree.mockReset();
});

describe('useWorkspaceFileCount', () => {
  it('counts the top folder once, however many places ask at the same time', async () => {
    getTree.mockResolvedValue({ items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] });
    const { count, load } = useWorkspaceFileCount();
    expect(count.value).toBeNull();
    await Promise.all([load(), useWorkspaceFileCount().load()]);
    expect(count.value).toBe(3);
    expect(getTree).toHaveBeenCalledTimes(1);
    expect(getTree).toHaveBeenCalledWith('');
    await load();
    expect(getTree).toHaveBeenCalledTimes(1);
  });

  it('takes the count the Files page reports after an upload, without asking again', async () => {
    const { count, load } = useWorkspaceFileCount();
    reportWorkspaceRootCount(new Array(7).fill({}));
    expect(count.value).toBe(7);
    await load();
    expect(getTree).not.toHaveBeenCalled();
  });

  it('stays unknown rather than wrong when the workspace cannot be read', async () => {
    getTree.mockRejectedValue(new Error('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { count, load } = useWorkspaceFileCount();
    await load();
    expect(count.value).toBeNull();
    warn.mockRestore();
  });
});
