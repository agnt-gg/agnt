// SkillForge extraction provenance: the LLM judge now emits `rationale` and
// `relatedSkills` on skill candidates. _validateAnalysis must pass valid values
// through and normalize garbage to safe nulls/arrays — SkillEvolver persists
// them into metadata.provenance / metadata.relations.
import { describe, it, expect, vi } from 'vitest';

// TraceAnalyzer pulls in models + LLM plumbing at module scope; stub them all —
// _validateAnalysis is pure and touches none of it.
vi.mock('../../models/GoalModel.js', () => ({ default: {} }));
vi.mock('../../models/TaskModel.js', () => ({ default: {} }));
vi.mock('../../models/GoalIterationModel.js', () => ({ default: {} }));
vi.mock('./GoalEvaluator.js', () => ({ default: {} }));
vi.mock('../ai/LlmService.js', () => ({ createLlmClient: vi.fn() }));
vi.mock('../orchestrator/llmAdapters.js', () => ({ createLlmAdapter: vi.fn() }));
vi.mock('../ai/providerConfigs.js', () => ({ getProviderConfig: vi.fn() }));

import TraceAnalyzer from './TraceAnalyzer.js';

const baseAnalysis = {
  traceQuality: 'high',
  overallAssessment: 'Good run',
  patterns: [],
  antipatterns: [],
  insights: [],
};

function validate(candidate) {
  return TraceAnalyzer._validateAnalysis(JSON.stringify({
    ...baseAnalysis,
    skillCandidate: candidate,
  }));
}

describe('TraceAnalyzer._validateAnalysis — provenance fields', () => {
  const validCandidate = {
    shouldGenerate: true,
    confidence: 0.82,
    name: 'Retry Then Fallback',
    category: 'debugging',
    description: 'Retry with fallback strategy',
    allowedTools: [],
    instructions: '# Strategy\nDo it.',
    estimatedEffectiveness: 0.78,
  };

  it('passes rationale and relatedSkills through untouched when valid', () => {
    const analysis = validate({
      ...validCandidate,
      rationale: 'From tasks 2-4; generalizes to rate-limited APIs.',
      relatedSkills: { composesWith: ['media-use'], dependsOn: [], supersedes: [] },
    });
    const sc = analysis.skillCandidate;
    expect(sc.rationale).toBe('From tasks 2-4; generalizes to rate-limited APIs.');
    expect(sc.relatedSkills).toEqual({ composesWith: ['media-use'], dependsOn: [], supersedes: [] });
  });

  it('normalizes missing rationale to null and missing relatedSkills to null', () => {
    const analysis = validate(validCandidate);
    expect(analysis.skillCandidate.rationale).toBeNull();
    expect(analysis.skillCandidate.relatedSkills).toBeNull();
  });

  it('normalizes non-array relation lists to empty arrays', () => {
    const analysis = validate({
      ...validCandidate,
      relatedSkills: { composesWith: 'not-an-array', dependsOn: ['ok'] },
    });
    const rs = analysis.skillCandidate.relatedSkills;
    expect(rs.composesWith).toEqual([]);
    expect(rs.dependsOn).toEqual(['ok']);
    expect(rs.supersedes).toEqual([]);
  });

  it('normalizes array-shaped relatedSkills to null', () => {
    const analysis = validate({ ...validCandidate, relatedSkills: ['wrong'] });
    expect(analysis.skillCandidate.relatedSkills).toBeNull();
  });

  it('still disables candidates missing required fields', () => {
    const analysis = validate({ shouldGenerate: true, rationale: 'x' });
    expect(analysis.skillCandidate.shouldGenerate).toBe(false);
  });
});
