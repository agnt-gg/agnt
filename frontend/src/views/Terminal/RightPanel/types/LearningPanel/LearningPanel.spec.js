/**
 * The Learning page's right panel: the selected item's receipt and verbs.
 * Every verb is emitted as a `learning` panel-action for Learning.vue to run.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import LearningPanel from './LearningPanel.vue';

const finding = { kind: 'finding', id: 'f', revision: 3, state: 'detected', capability: 'read_file', error_kind: 'timeout', occurrences: 7, independent_runs: 4, candidate: { when: { capability: 'read_file', error_kind: 'timeout' } }, candidate_hash: 'hash' };
const trial = { kind: 'trial', id: 't', revision: 1, state: 'watching', candidate: finding.candidate, baseline: { eligible: 28 }, started_at: Date.now() - 86400000, review_due_at: Date.now() + 6 * 86400000 };
const insight = { kind: 'insight', id: 'i', title: 'Tighten the prompt', description: 'Shorter system prompt', autonomy_reason: 'Blast radius above your limit', target_type: 'agent', target_id: 'agent-1', confidence: 0.8 };

const verbs = (w) => (w.emitted('panel-action') || []).map(([action, { verb, item }]) => [action, verb, item?.id]);
const button = (w, text) => w.findAll('button').find((b) => b.text() === text);

describe('LearningPanel', () => {
  it('with nothing selected, summarises the page', () => {
    const w = mount(LearningPanel, { props: { summary: { waiting: 384, attention: 2, watching: 1, learned: 0 } } });
    expect(w.text()).toContain('384');
    expect(w.text()).toContain('Waiting for you');
  });

  it('an insight shows why it is waiting, and accepts or rejects it', async () => {
    const w = mount(LearningPanel, { props: { selected: insight } });
    expect(w.text()).toContain('Blast radius above your limit');
    expect(w.text()).toContain('agent-1');
    await button(w, 'Accept').trigger('click');
    await button(w, 'Reject').trigger('click');
    expect(verbs(w)).toEqual([['learning', 'accept', 'i'], ['learning', 'reject', 'i']]);
  });

  it('a finding shows its evidence and emits an exact hash-bound approval', async () => {
    const w = mount(LearningPanel, { props: { selected: finding } });
    expect(w.text()).toContain('Independent runs');
    await button(w, 'Try for 7 days').trigger('click');
    expect(w.emitted('panel-action')[0][1].item).toMatchObject({ id: 'f', revision: 3, candidate_hash: 'hash' });
  });

  it('cannot start a trial while learning is paused', () => {
    const w = mount(LearningPanel, { props: { selected: finding, paused: true } });
    expect(button(w, 'Try for 7 days').attributes('disabled')).toBeDefined();
  });

  it('a running trial offers undo, never keep', async () => {
    const w = mount(LearningPanel, { props: { selected: trial } });
    expect(button(w, 'Keep this improvement')).toBeUndefined();
    await button(w, 'Undo change').trigger('click');
    expect(verbs(w)).toEqual([['learning', 'undo', 't']]);
  });

  it('never lets an inconclusive result keep a change', () => {
    const reviewed = { ...trial, state: 'reviewed', result: { verdict: 'inconclusive', before: 0.25, after: null, candidate: { eligible: 0 }, method: 'observational_before_after', explanation: 'Not enough evidence' } };
    const w = mount(LearningPanel, { props: { selected: reviewed } });
    expect(w.text()).toContain('Not enough evidence');
    expect(button(w, 'Keep this improvement')).toBeUndefined();
  });

  it('offers keep for a supported result', async () => {
    const supported = { ...trial, state: 'reviewed', result: { verdict: 'supported', before: 0.25, after: 0.05, candidate: { eligible: 30 }, method: 'observational', explanation: 'Fewer failures' } };
    const w = mount(LearningPanel, { props: { selected: supported } });
    await button(w, 'Keep this improvement').trigger('click');
    expect(verbs(w)).toEqual([['learning', 'keep', 't']]);
  });

  it('disables every verb while the page is busy', () => {
    const w = mount(LearningPanel, { props: { selected: insight, busy: true } });
    expect(button(w, 'Accept').attributes('disabled')).toBeDefined();
    expect(button(w, 'Reject').attributes('disabled')).toBeDefined();
  });
});
