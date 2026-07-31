import { describe, expect, it, vi } from 'vitest';

vi.mock('../models/database/index.js', () => ({ default: { run: vi.fn() } }));
vi.mock('../models/AgentModel.js', () => ({ default: { createOrUpdate: vi.fn() } }));
vi.mock('../utils/generateUUID.js', () => ({ default: () => 'new-agent-id' }));
vi.mock('../utils/pluginSlugResolver.js', () => ({
  resolveRefList: vi.fn(async (refs) => ({ resolved: refs, missing: [] })),
}));

import AgentModel from '../models/AgentModel.js';
import { buildAgentEnvelope, importAgent } from './AgentImportService.js';

describe('AgentImportService fallback configuration', () => {
  it('exports the per-agent fallback chain', () => {
    const envelope = buildAgentEnvelope({
      name: 'Researcher',
      fallbackEnabled: true,
      fallbackProviders: [{ provider: 'OpenAI', model: 'gpt-4o' }],
      assignedTools: [],
      assignedSkills: [],
      assignedWorkflows: [],
    });

    expect(envelope.payload.fallbackEnabled).toBe(true);
    expect(envelope.payload.fallbackProviders).toEqual([{ provider: 'OpenAI', model: 'gpt-4o' }]);
  });

  it('imports at most three fallback tiers', async () => {
    await importAgent({
      name: 'Researcher',
      fallbackEnabled: true,
      fallbackProviders: [
        { provider: 'OpenAI', model: 'a' },
        { provider: 'Anthropic', model: 'b' },
        { provider: 'Gemini', model: 'c' },
        { provider: 'GrokAI', model: 'd' },
      ],
    }, 'user-1');

    const saved = AgentModel.createOrUpdate.mock.calls[0][1];
    expect(saved.fallbackEnabled).toBe(true);
    expect(saved.fallbackProviders).toHaveLength(3);
  });
});
