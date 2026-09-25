import { describe, it, expect } from 'vitest';
import { AGENT_QUICKSTARTS, quickstartDraft } from './agentQuickstarts.js';
import { fitWithin } from '@/utils/avatarImage.js';

describe('agent quickstarts', () => {
  it('every template is complete and uniquely identified', () => {
    const ids = AGENT_QUICKSTARTS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of AGENT_QUICKSTARTS) {
      expect(t.name && t.description && t.systemPrompt && t.icon, t.id).toBeTruthy();
      expect(Array.isArray(t.tools), t.id).toBe(true);
    }
  });

  it('only assigns tools this install actually has', () => {
    const researcher = AGENT_QUICKSTARTS.find((t) => t.id === 'researcher');
    const draft = quickstartDraft(researcher, [{ id: 'web_search' }, { id: 'unrelated' }]);
    expect(draft.tools).toEqual(['web_search']);
    expect(draft).toMatchObject({ name: 'Research Analyst', skills: [] });
    expect(quickstartDraft(researcher, []).tools).toEqual([]);
  });
});

describe('fitWithin', () => {
  it('scales the long side down to the limit and keeps the ratio', () => {
    expect(fitWithin(1024, 512, 256)).toEqual({ width: 256, height: 128 });
    expect(fitWithin(300, 900, 256)).toEqual({ width: 85, height: 256 });
  });
  it('never upscales and rejects empty images', () => {
    expect(fitWithin(100, 80, 256)).toEqual({ width: 100, height: 80 });
    expect(fitWithin(0, 80, 256)).toEqual({ width: 0, height: 0 });
  });
});
