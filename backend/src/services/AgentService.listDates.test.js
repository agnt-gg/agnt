import { describe, it, expect, vi } from 'vitest';
vi.mock('./OrchestratorService.js', () => ({ default: vi.fn() }));
vi.mock('../models/database/index.js', () => ({ default: { run: vi.fn(), get: vi.fn(), all: vi.fn() } }));
vi.mock('../models/UserModel.js', () => ({ default: { getUserSettings: vi.fn() } }));
vi.mock('../models/AgentModel.js', () => ({ default: { findAllByUserId: vi.fn(), findResourcesForAgents: vi.fn() } }));
vi.mock('../utils/realtimeSync.js', () => ({ broadcast: vi.fn(), broadcastToUser: vi.fn(), RealtimeEvents: {} }));
import AgentService from './AgentService.js';
import AgentModel from '../models/AgentModel.js';

// The agents list carries when each was made and last changed, as the summary list does,
// so the Library can sort them.
describe('the agents list', () => {
  it('includes createdAt and updatedAt', async () => {
    AgentModel.findAllByUserId.mockResolvedValue([{ id: 'a1', name: 'Scout', created_at: '2026-01-02 03:04:05', updated_at: '2026-11-20 12:00:00' }]);
    AgentModel.findResourcesForAgents.mockResolvedValue([]);
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await AgentService.getAllAgents({ user: { userId: 'u1' } }, res);
    expect(res.json).toHaveBeenCalledWith({ agents: [expect.objectContaining({ id: 'a1', createdAt: '2026-01-02 03:04:05', updatedAt: '2026-11-20 12:00:00' })] });
  });
});
