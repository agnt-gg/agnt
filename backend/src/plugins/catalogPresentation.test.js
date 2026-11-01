import { describe, it, expect } from 'vitest';
import { catalogPresentation } from './catalogPresentation.js';

describe('Catalog presentation metadata', () => {
  it('exposes all five package categories through tools plus safe asset summaries', () => {
    expect(catalogPresentation({ agents: [{ slug: 'researcher', definition: './agents/researcher.json' }], widgets: [], skills: ['method'], workflows: [{ name: 'Digest', description: 'Weekly', nodes: ['private'] }] })).toEqual({
      agents: [{ slug: 'researcher', name: undefined, description: undefined }], widgets: [], skills: [{ slug: 'method' }], workflows: [{ slug: 'Digest', name: 'Digest', description: 'Weekly' }],
    });
  });
  it('does not leak prompts, widget code, workflow graphs or credential metadata', () => {
    const result = catalogPresentation({ agents: [{ payload: { name: 'Agent', systemPrompt: 'PRIVATE' } }], widgets: [{ name: 'Board', source_code: 'PRIVATE' }], workflows: [{ name: 'Flow', nodes: ['PRIVATE'] }], apiKey: 'PRIVATE' });
    expect(JSON.stringify(result)).not.toContain('PRIVATE');
  });
  it('passes the store shelf (kind) through only when it is app, pack or utility', () => {
    expect(catalogPresentation({ kind: 'app' })).toEqual({ kind: 'app' });
    expect(catalogPresentation({ kind: ' Pack ' })).toEqual({ kind: 'pack' });
    expect(catalogPresentation({ kind: 'connector' })).toEqual({});
    expect(catalogPresentation({ kind: 42 })).toEqual({});
  });
  it('does not turn absent metadata into fabricated zero counts', () => {
    expect(catalogPresentation({})).toEqual({});
    expect(catalogPresentation({ agents: null })).toEqual({});
    expect(catalogPresentation({ category: 'research', license: 'MIT', permissions: { capabilities: ['network'] } })).toMatchObject({ category: 'research', license: 'MIT', permissions: { capabilities: ['network'] } });
  });
});
