import { describe, it, expect, vi } from 'vitest';
import { firstWinKey, isFinishedTask, loadFirstWin, ranOnFor, receiptFor, saveFirstWin } from './firstWin.js';

const step = (name, extra = {}) => ({ id: name, name, args: {}, result: { ok: true }, ...extra });
const reply = (toolCalls, extra = {}) => ({ id: 'm1', role: 'assistant', content: 'Done.', toolCalls, ...extra });

function memoryStorage() {
  const items = new Map();
  return { getItem: (key) => (items.has(key) ? items.get(key) : null), setItem: (key, value) => items.set(key, String(value)), items };
}

describe('a finished task', () => {
  it('is a reply with two or more steps, every one of which succeeded', () => {
    expect(isFinishedTask(reply([step('calendar'), step('gmail')]))).toBe(true);
    expect(isFinishedTask(reply([step('calendar'), step('gmail'), step('docs')]))).toBe(true);
  });

  it('is not a one-step answer, or a reply with no steps', () => {
    expect(isFinishedTask(reply([step('search')]))).toBe(false);
    expect(isFinishedTask(reply([]))).toBe(false);
    expect(isFinishedTask(reply(undefined))).toBe(false);
  });

  it('is not a run with a failed, interrupted or unanswered step', () => {
    expect(isFinishedTask(reply([step('a'), step('b', { error: 'boom' })]))).toBe(false);
    expect(isFinishedTask(reply([step('a'), step('b', { status: 'interrupted' })]))).toBe(false);
    expect(isFinishedTask(reply([step('a'), step('b', { result: undefined })]))).toBe(false);
    expect(isFinishedTask(reply([step('a'), step('b', { result: null })]))).toBe(false);
  });

  it("is never the person's own message, or a reply that ended out of credits", () => {
    expect(isFinishedTask({ ...reply([step('a'), step('b')]), role: 'user' })).toBe(false);
    expect(isFinishedTask(reply([step('a'), step('b')], { content: 'You are out of credits.\n<!-- agnt-notice:trial_credit_exhausted -->' }))).toBe(false);
    expect(isFinishedTask(null)).toBe(false);
  });
});

describe('what the task ran on', () => {
  it('names AGNT Flash, a plan the person pays for, or another AI', () => {
    expect(ranOnFor('AGNT')).toEqual({ kind: 'flash' });
    expect(ranOnFor('OpenAI-Codex')).toEqual({ kind: 'plan', label: 'ChatGPT' });
    expect(ranOnFor('openai').kind).toBe('other');
    expect(ranOnFor('')).toBeNull();
  });

  it('reads as a receipt', () => {
    const trial = { trial: true, includedCredits: 1_000_000, usedCredits: 40_000 };
    expect(receiptFor({ kind: 'flash' }, trial)).toBe("It ran on your free AGNT Flash credits, and you've used about 4% of them.");
    expect(receiptFor({ kind: 'flash' }, { trial: false, includedCredits: 5_000_000, usedCredits: 1 })).toBe('It ran on AGNT Flash.');
    expect(receiptFor({ kind: 'flash' }, null)).toBe('It ran on AGNT Flash.');
    expect(receiptFor({ kind: 'plan', label: 'ChatGPT' })).toBe('It ran on your ChatGPT plan, at no extra charge.');
    expect(receiptFor({ kind: 'other', label: 'OpenAI' })).toBe('It ran on OpenAI.');
    expect(receiptFor(null)).toBe('');
  });
});

describe('kept per account', () => {
  it('round-trips a claim under the account', () => {
    const storage = memoryStorage();
    saveFirstWin('maya@example.com', { messageId: 'm1', firstTask: true, ranOn: { kind: 'plan', label: 'ChatGPT' }, dismissed: false }, storage);
    expect(storage.items.has(firstWinKey('maya@example.com'))).toBe(true);
    expect(loadFirstWin('maya@example.com', storage)).toEqual({ messageId: 'm1', firstTask: true, ranOn: { kind: 'plan', label: 'ChatGPT' }, dismissed: false });
    expect(loadFirstWin('someone@else.test', storage).messageId).toBeNull();
  });

  it('lets only known keys and types through', () => {
    const storage = memoryStorage();
    storage.setItem(firstWinKey('a'), JSON.stringify({ messageId: 7, firstTask: 'yes', ranOn: { kind: 'html', label: '<b>' }, dismissed: 1, extra: true }));
    expect(loadFirstWin('a', storage)).toEqual({ messageId: null, firstTask: false, ranOn: null, dismissed: false });
    storage.setItem(firstWinKey('b'), '{not json');
    expect(loadFirstWin('b', storage).messageId).toBeNull();
  });

  it('keeps the claim for the session when storage refuses it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
    expect(saveFirstWin('a', { messageId: 'm1', dismissed: true }, full)).toEqual({ messageId: 'm1', firstTask: false, ranOn: null, dismissed: true });
    warn.mockRestore();
  });
});
