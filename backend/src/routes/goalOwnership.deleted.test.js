import { it, expect, vi } from 'vitest';

// bravo retest: GET /goals/:id was 404 after delete, but /goals/:id/status still answered.
vi.mock('../models/GoalModel.js', () => ({ default: { findOne: async (id) => ({ id, user_id: 'u1', deleted_at: id === 'gone' ? '2026-11-02' : null }) } }));
const { requireOwnedGoal } = await import('./goalOwnership.js');

async function through(id, query = {}) {
  let status = 200; let passed = false;
  const res = { status(code) { status = code; return this; }, json() { return this; } };
  await requireOwnedGoal()({ params: { id }, query, user: { userId: 'u1' } }, res, () => { passed = true; });
  return passed ? 'next' : status;
}

it('a deleted goal is 404 on every goal route, unless includeDeleted is asked for', async () => {
  expect(await through('gone')).toBe(404);
  expect(await through('gone', { includeDeleted: 'true' })).toBe('next');
  expect(await through('alive')).toBe('next');
});
