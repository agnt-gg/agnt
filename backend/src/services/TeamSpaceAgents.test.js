import { describe, it, expect, vi } from 'vitest';
import { readFinishLines, runAgentOnTask, stopReason } from './TeamSpaceAgents.js';

describe('how an agent finishes a card', () => {
  it('reads checks with any dash or a colon, keeps the reasons, and leaves the rest as the reply', () => {
    const reply = [
      'The quote is ready.',
      'CHECK: Prices match the price list \u2014 passed',
      'CHECK: Re-checked the seat count - failed: the CRM says 230, the request says 240',
      '- check: Customer email drafted: passed',
      'CHECK: Something without a verdict',
    ].join('\n');
    const { text, checks, decision } = readFinishLines(reply);
    expect(text).toBe('The quote is ready.');
    expect(checks).toEqual([
      { label: 'Prices match the price list', ok: true, detail: '' },
      { label: 'Re-checked the seat count', ok: false, detail: 'the CRM says 230, the request says 240' },
      { label: 'Customer email drafted', ok: true, detail: '' },
      { label: 'Something without a verdict', ok: null, detail: '' },
    ]);
    expect(decision).toBeNull();
  });

  it('a DECISION NEEDED line stops the card, with at most three options', () => {
    const reply = 'The supplier page says $38, the signed quote says $34.\nDECISION NEEDED: prices disagree\nOPTION: Use the signed price ($34)\nOPTION: Use the supplier price ($38)\nOPTION: Ask the supplier\nOPTION: A fourth one';
    expect(readFinishLines(reply)).toEqual({
      text: 'The supplier page says $38, the signed quote says $34.',
      checks: [],
      decision: { reason: 'prices disagree', options: ['Use the signed price ($34)', 'Use the supplier price ($38)', 'Ask the supplier'] },
    });
  });

  it('a technical stop names its cause in a few words', () => {
    expect(stopReason({ code: 'publish_required' })).toBe('not published here yet');
    expect(stopReason({ status: 422, message: 'The run failed' })).toBe('The run failed');
    expect(stopReason(new Error('boom'))).toBe('the run failed');
  });
});

describe('runAgentOnTask outcomes', () => {
  const spaces = () => ({ setAgentState: vi.fn(async () => ({})), requestApproval: vi.fn(async () => ({})) });
  const base = { teamId: 't', workspaceId: 'w', taskId: 'c', agentId: 'a', input: 'Task: x', started: true };

  it('a result with checks goes to Review with the checks, stripped from the reply', async () => {
    const s = spaces();
    const outcome = await runAgentOnTask({ ...base, spaces: s, execute: async () => ({ status: 'completed', result: { content: 'Done.\nCHECK: Totals add up \u2014 passed' } }) });
    expect(outcome).toEqual({ ok: true, text: 'Done.' });
    expect(s.setAgentState).toHaveBeenCalledWith('t', 'w', 'c', expect.objectContaining({ state: 'waiting', status: 'review', result: 'Done.', checks: [{ label: 'Totals add up', ok: true, detail: '' }] }));
    expect(s.requestApproval).toHaveBeenCalled();
  });

  it('a stop for a decision blocks the card with the reason and options, and asks for no approval', async () => {
    const s = spaces();
    const outcome = await runAgentOnTask({ ...base, spaces: s, execute: async () => ({ status: 'completed', result: { content: 'Two prices.\nDECISION NEEDED: prices disagree\nOPTION: Use $34' } }) });
    expect(outcome).toEqual({ ok: false, stopped: true, decision: { reason: 'prices disagree', options: ['Use $34'] }, text: 'Two prices.' });
    expect(s.setAgentState).toHaveBeenCalledWith('t', 'w', 'c', expect.objectContaining({ state: 'blocked', status: 'todo', reason: 'prices disagree', comment: 'Two prices.' }));
    expect(s.requestApproval).not.toHaveBeenCalled();
  });

  it('a team lead deciding for another agent hands its answer back instead of asking for approval', async () => {
    const s = spaces();
    const outcome = await runAgentOnTask({ ...base, spaces: s, decides: true, execute: async () => ({ status: 'completed', result: { content: 'Use the signed price.' } }) });
    expect(outcome).toEqual({ ok: true, decided: true, text: 'Use the signed price.' });
    expect(s.setAgentState).not.toHaveBeenCalled();
    expect(s.requestApproval).not.toHaveBeenCalled();
  });
});
