import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Version history is keyed by workflow id alone and the id comes from the
 * caller's request context. Before 2026-10-29 one member of a shared instance
 * could list, checkpoint or revert another member's workflow through these
 * tools. They must answer "not found" for a workflow the caller does not own.
 */
const rows = new Map();
vi.mock('../../models/WorkflowModel.js', () => ({
  default: {
    findOne: vi.fn(async (id) => rows.get(id) || null),
    createOrUpdate: vi.fn(async () => ({ changes: 1 })),
  },
}));
const versions = {
  getVersionHistory: vi.fn(async () => [{ id: 2, version_number: 2, created_at: 0 }, { id: 1, version_number: 1, created_at: 0 }]),
  getVersion: vi.fn(async () => ({ id: 1 })),
  revertToVersion: vi.fn(async () => ({ workflowState: { nodes: [] }, revertedToVersion: 1, newVersion: { versionNumber: 3 } })),
  createCheckpoint: vi.fn(async () => ({ versionId: 9, versionNumber: 9 })),
};
vi.mock('../WorkflowVersionService.js', () => ({ default: versions }));
vi.mock('../../utils/realtimeSync.js', () => ({ broadcastToUser: vi.fn(), RealtimeEvents: {} }));

const { executeWorkflowTool } = await import('./workflowTools.js');
const call = async (tool, args, userId, workflowId) =>
  JSON.parse(await executeWorkflowTool(tool, args, null, { userId, workflowId, workflowState: { nodes: [] } }));

describe('workflow version tools respect ownership', () => {
  beforeEach(() => {
    rows.clear();
    rows.set('amber-wf', { id: 'amber-wf', user_id: 'amber' });
    for (const fn of Object.values(versions)) fn.mockClear();
  });

  for (const [tool, args, touched] of [
    ['list_workflow_versions', {}, 'getVersionHistory'],
    ['revert_workflow', { steps: 1 }, 'revertToVersion'],
    ['create_checkpoint', { name: 'mine now' }, 'createCheckpoint'],
  ]) {
    it(`${tool}: another member's workflow is not found and its history is untouched`, async () => {
      const result = await call(tool, args, 'john', 'amber-wf');
      expect(result.success).toBe(false);
      expect(result.error).toBe('Workflow not found');
      expect(versions[touched]).not.toHaveBeenCalled();
    });

    it(`${tool}: the owner of the workflow still can`, async () => {
      const result = await call(tool, args, 'amber', 'amber-wf');
      expect(result.success).toBe(true);
      expect(versions[touched]).toHaveBeenCalled();
    });
  }

  it('a new, unsaved workflow (no row yet) belongs to the caller', async () => {
    const result = await call('create_checkpoint', { name: 'first' }, 'john', 'brand-new');
    expect(result.success).toBe(true);
  });
});
