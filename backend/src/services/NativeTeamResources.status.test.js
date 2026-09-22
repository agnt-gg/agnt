import { describe, it, expect } from 'vitest';
import { publicationStatus, modelHintsOf, definitionOf } from './NativeTeamResources.js';

describe('publication status', () => {
  const mapping = { content_hash: 'h1' };
  it('is draft until published, published while unchanged, changed after an edit', () => {
    expect(publicationStatus('h1', null, null, null)).toBe('draft');
    expect(publicationStatus('h1', mapping, null, { revision: 1 })).toBe('draft');
    expect(publicationStatus('h1', mapping, { approved_revision: 1 }, { revision: 1 })).toBe('published');
    expect(publicationStatus('h2', mapping, { approved_revision: 1 }, { revision: 1 })).toBe('changed');
    expect(publicationStatus('h1', mapping, { approved_revision: 1 }, { revision: 2 })).toBe('changed');
  });
});

describe('model hints', () => {
  it('reads provider and model from the live row without changing the snapshot definition', () => {
    const agent = { name: 'A', system_prompt: 'p', provider: 'openai', model: 'gpt-4o', tools: '[]', workflows: '[]', skills: '[]' };
    expect(modelHintsOf('agent', agent)).toEqual({ provider: 'openai', model: 'gpt-4o' });
    // Existing snapshots stay published: the definition carries no provider or model.
    expect(Object.keys(definitionOf('agent', agent)).sort()).toEqual(['assignedSkills', 'assignedTools', 'assignedWorkflows', 'name', 'systemPrompt']);
    expect(modelHintsOf('workflow', { workflow_data: JSON.stringify({ nodes: [{ type: 'x' }, { parameters: { provider: 'anthropic', model: 'claude' } }] }) })).toEqual({ provider: 'anthropic', model: 'claude' });
    expect(modelHintsOf('tool', { config: JSON.stringify({ provider: 'groq' }) })).toEqual({ provider: 'groq', model: null });
  });
});
