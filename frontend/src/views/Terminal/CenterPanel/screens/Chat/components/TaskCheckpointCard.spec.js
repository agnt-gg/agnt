import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createStore } from 'vuex';
import { checkpointTarget, decisionReply } from './checkpointCards.js';

vi.mock('@/composables/useRealtimeSync.js', () => ({ getRealtimeSocket: () => null }));
vi.mock('@/tt.config.js', () => ({ API_CONFIG: { BASE_URL: 'http://api' } }));
const { default: TaskCheckpointCard } = await import('./TaskCheckpointCard.vue');
const { _resetCheckpoints } = await import('@/composables/useCheckpoints.js');

describe('checkpointTarget', () => {
  it('is a card only for a completed, successful task_checkpoint call', () => {
    const result = JSON.stringify({ success: true, checkpoint: { id: 'cp1', kind: 'review', title: 'Check the email' } });
    expect(checkpointTarget({ name: 'task_checkpoint', result })).toEqual({ id: 'cp1', kind: 'review', title: 'Check the email' });
    expect(checkpointTarget({ name: 'task_checkpoint', args: '{"kind":"plan"' })).toBeNull();
    expect(checkpointTarget({ name: 'task_checkpoint', result: JSON.stringify({ success: false, error: 'x' }) })).toBeNull();
    expect(checkpointTarget({ name: 'agnt_auth', result })).toBeNull();
  });
  it('the reply that resumes Annie names what was decided', () => {
    expect(decisionReply({ kind: 'plan', title: 'The plan' }, 'approved')).toBe('Approved: “The plan”. Go ahead.');
    expect(decisionReply({ kind: 'routine', title: 'Chase invoices' }, 'approved')).toMatch(/turn on the routine/);
    expect(decisionReply({ kind: 'run', title: 'This run' }, 'skipped')).toMatch(/^Skip this run/);
  });
});

describe('TaskCheckpointCard', () => {
  let calls, card, asks;
  const listener = (e) => asks.push(e.detail);
  beforeEach(() => {
    _resetCheckpoints();
    calls = [];
    asks = [];
    card = { id: 'cp1', conversationId: 'conv', outputId: null, kind: 'review', title: 'Check the email', content: '**To:** sam@globex.com\n\nHi Sam <script>alert(1)</script>', taskTitle: 'Thank Globex', state: 'pending', task: null };
    global.fetch = vi.fn(async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
      if (String(url).endsWith('/decide')) return { ok: true, json: async () => ({ checkpoint: { ...card, state: 'approved' } }) };
      if (String(url).endsWith('/locate')) return { ok: true, json: async () => ({ ...card, outputId: 'out-7' }) };
      return { ok: true, json: async () => card };
    });
    window.addEventListener('agnt:ask-annie', listener);
  });
  afterEach(() => window.removeEventListener('agnt:ask-annie', listener));

  const mountCard = (savedOutputId = 'out-7') => mount(TaskCheckpointCard, {
    props: { target: { id: 'cp1', kind: 'review', title: 'Check the email' } },
    global: { plugins: [createStore({ state: { chat: { savedOutputId } } })], provide: { focusedNav: { go: vi.fn() } } },
  });

  it('shows the whole thing being approved, sanitised, above the buttons', async () => {
    const w = mountCard();
    await flushPromises();
    expect(w.find('.tc-body').html()).toContain('sam@globex.com');
    expect(w.find('.tc-body script').exists()).toBe(false);
    expect(w.find('.tc-foot .primary').text()).toBe('Approve');
    expect(w.text()).toContain('Nothing happens until you approve.');
  });

  it('approve records the decision, then resumes Annie in this chat', async () => {
    const w = mountCard();
    await flushPromises();
    await w.find('.tc-foot .primary').trigger('click');
    await flushPromises();
    expect(calls.find((c) => c.url.endsWith('/decide')).body).toEqual({ decision: 'approved' });
    expect(asks).toEqual([{ text: 'Approved: “Check the email”. Go ahead.', send: true }]);
    expect(w.find('.tc-foot').exists()).toBe(false);
    expect(w.text()).toContain('Approved');
  });

  it('ask for changes types into the composer and sends nothing', async () => {
    const w = mountCard();
    await flushPromises();
    await w.findAll('.tc-foot .btn').find((b) => b.text() === 'Ask for changes').trigger('click');
    expect(asks).toEqual([{ text: 'Change to “Check the email”: ', send: false }]);
    expect(calls.some((c) => c.url.endsWith('/decide'))).toBe(false);
  });

  it('remembers which saved chat it lives in, so Review can reopen it', async () => {
    mountCard('out-7');
    await flushPromises();
    expect(calls.find((c) => c.url.endsWith('/locate')).body).toEqual({ outputId: 'out-7' });
  });

  it('only a routine run offers Skip', async () => {
    card = { ...card, kind: 'run', title: 'This run' };
    const w = mountCard();
    await flushPromises();
    expect(w.findAll('.tc-foot .btn').map((b) => b.text())).toContain('Skip this run');
  });
});
