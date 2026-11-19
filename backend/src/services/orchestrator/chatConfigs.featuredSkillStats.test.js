/**
 * The skills catalog's featured tier is built from per-user activation stats.
 * Every new conversation builds a fresh context, so these tests drive the real
 * prompt builder with fresh contexts and count the stats queries behind them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./tools.js', () => ({ getAvailableToolSchemas: vi.fn(async () => []) }));
vi.mock('./workspaceContext.js', () => ({ loadWorkspaceContextSection: vi.fn(async () => '') }));
vi.mock('../../models/AgentModel.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../models/UserModel.js', () => ({ default: { getUserSettings: vi.fn(async () => ({})) } }));
vi.mock('../../models/AgentMemoryModel.js', () => ({
  default: { searchRelevant: vi.fn(async () => []), findByAgentId: vi.fn(async () => []), findByUserId: vi.fn(async () => []) },
}));
vi.mock('../../models/SkillModel.js', () => ({
  default: {
    findAll: vi.fn(async () => [{ slug: 'code-review', description: 'Reviews code for bugs.' }]),
    findByIds: vi.fn(async () => []),
    activationStats: vi.fn(async () => []),
  },
}));

import { getChatConfig } from './chatConfigs.js';
import AgentModel from '../../models/AgentModel.js';
import SkillModel from '../../models/SkillModel.js';

const config = getChatConfig('agent');
const freshContext = (userId) => ({ agentId: 'agent-reviewer', userId, latestUserMessage: 'review this diff' });

async function startConversation(userId) {
  const ctx = freshContext(userId);
  await config.getToolSchemas(ctx);
  return config.buildSystemPrompt(ctx);
}

beforeEach(() => {
  vi.clearAllMocks();
  AgentModel.findOne.mockResolvedValue({
    id: 'agent-reviewer', name: 'Reviewer', description: 'Reviews code.', systemPrompt: 'You review code.',
    assignedTools: [], assignedSkills: [], toolAccessMode: 'restricted',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

// The loader lives for the module's lifetime, so each test uses its own user.
describe('featured skill stats behind the skills catalog', () => {
  it('are queried once for several new conversations of the same user', async () => {
    await startConversation('user-same');
    await startConversation('user-same');
    await startConversation('user-same');
    expect(SkillModel.activationStats).toHaveBeenCalledTimes(1);
    expect(SkillModel.activationStats).toHaveBeenCalledWith('user-same', expect.any(String));
  });

  it('are queried separately for each user', async () => {
    await startConversation('user-one');
    await startConversation('user-two');
    expect(SkillModel.activationStats.mock.calls.map(([userId]) => userId)).toEqual(['user-one', 'user-two']);
  });

  it('are queried again once the reuse window has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-19T00:00:00Z'));
    await startConversation('user-window');
    vi.setSystemTime(new Date('2026-11-19T00:09:59Z'));
    await startConversation('user-window');
    expect(SkillModel.activationStats).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-11-19T00:10:01Z'));
    await startConversation('user-window');
    expect(SkillModel.activationStats).toHaveBeenCalledTimes(2);
  });

  it('are retried after a failed query, and the prompt still builds meanwhile', async () => {
    SkillModel.activationStats.mockRejectedValueOnce(new Error('SQLITE_BUSY'));
    const prompt = await startConversation('user-retry');
    expect(prompt).toContain('code-review');

    await startConversation('user-retry');
    expect(SkillModel.activationStats).toHaveBeenCalledTimes(2);
  });
});
