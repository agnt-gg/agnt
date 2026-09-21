import { describe, it, expect } from 'vitest';
import { evaluateCompletion } from './completionGate.js';
const verified = (id) => ({ id, targetVersion: 'abc', evidence: { passed: true, revision: 1, validator: 'test', receipt: 'receipt-1', targetVersion: 'abc' } });
describe('completion authority', () => {
  it('continues the Teams case irrespective of polished final prose', () => {
    expect(evaluateCompletion({ revision: 1, requirements: [verified('one'), ...['two','three','four','five'].map(id => ({id}))] })).toEqual({ status: 'queued', reason: 'requirements_unmet', unmet: ['two','three','four','five'] });
  });
  it('does not accept an empty contract', () => expect(evaluateCompletion({revision: 1, requirements: []}).status).toBe('queued'));
  it('accepts current evidence', () => expect(evaluateCompletion({revision: 1, requirements: [verified('one')]}).status).toBe('succeeded'));
  it('rejects evidence from an older contract', () => expect(evaluateCompletion({revision: 2, requirements: [verified('one')]}).status).toBe('queued'));
  it('rejects evidence from an older target', () => expect(evaluateCompletion({revision: 1, requirements: [{...verified('one'), targetVersion: 'new'}]}).status).toBe('queued'));
  it('waits for uncertain effects', () => expect(evaluateCompletion({revision: 1, requirements: [verified('one')], operations: [{status: 'unknown'}]}).reason).toBe('reconciliation_required'));
  it('queue acceptance is not completion', () => expect(evaluateCompletion({revision: 1, requirements: [verified('one')], operations: [{status: 'queued'}]}).status).toBe('waiting_dependency'));
  it('failed required operations prevent success', () => expect(evaluateCompletion({revision: 1, requirements: [verified('one')], operations: [{status: 'failed'}]}).status).toBe('queued'));
  it('Stop wins even over passing evidence', () => expect(evaluateCompletion({revision: 1, requirements: [verified('one')], paused: true}).status).toBe('paused'));
  it('rejects duplicate requirement identities', () => expect(() => evaluateCompletion({revision: 1, requirements: [verified('one'), verified('one')]})).toThrow());
});
