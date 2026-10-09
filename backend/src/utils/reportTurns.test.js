import { describe, it, expect } from 'vitest';
import { reportTurnKey, missingReportTurns } from './reportTurns.js';
import { buildReport, buildBatchReport } from '../services/orchestrator/subChatReports.js';

const ok = (title) => ({ title, conversationId: 'c1', outputId: 'o1', outcome: { ok: true, content: 'done' } });
const failed = (title) => ({ title, conversationId: 'c2', outputId: 'o2', outcome: { ok: false, error: 'x', content: '' } });
const asking = (title) => ({ title, conversationId: 'c3', outputId: 'o3', outcome: { ok: true, content: 'NEEDS INPUT: which?', needsInput: 'which?' } });
const payload = (messages) => JSON.stringify({ conversationId: 'c', messages });

describe('every report the server writes is recognised', () => {
  it.each([
    ['finished', buildReport(ok('A'))],
    ['finished with a problem', buildReport(failed('B'))],
    ['needs input', buildReport(asking('C'))],
    ['a batch', buildBatchReport([ok('A'), failed('B'), asking('C')])],
  ])('%s', (_label, report) => {
    expect(report.role).toBe('user');
    expect(reportTurnKey(report.content)).not.toBeNull();
  });

  it('ordinary user turns and server nudges are not reports', () => {
    expect(reportTurnKey('build a landing page')).toBeNull();
    expect(reportTurnKey('[System: Your previous response contained only tool calls with no text.]')).toBeNull();
    expect(reportTurnKey('see [System: Sub-chat finished] in the log')).toBeNull();
    expect(reportTurnKey(null)).toBeNull();
  });
});

describe('missingReportTurns', () => {
  const report = buildReport(ok('Landing page')).content;

  it('names a stored report the incoming transcript lacks', () => {
    expect(missingReportTurns(payload([{ role: 'user', content: 'hi' }]), [report])).toHaveLength(1);
  });

  it('matches across whitespace changes and a text-turn marker', () => {
    const incoming = payload([{ role: 'user', content: `[TEXT MESSAGE TURN]\n  ${report.replace(/\n/g, '\n\n')}` }]);
    expect(missingReportTurns(incoming, [report])).toEqual([]);
  });

  it('only a user turn carries a report', () => {
    expect(missingReportTurns(payload([{ role: 'assistant', content: report }]), [report])).toHaveLength(1);
  });

  it('judges nothing it cannot read', () => {
    expect(missingReportTurns('not json', [report])).toEqual([]);
    expect(missingReportTurns(payload([]), [])).toEqual([]);
    expect(missingReportTurns(payload([]), ['[System: Your previous response contained only tool calls]'])).toEqual([]);
  });

  it('reads the bare-array payload older clients send', () => {
    expect(missingReportTurns(JSON.stringify([{ role: 'user', content: report }]), [report])).toEqual([]);
  });
});
