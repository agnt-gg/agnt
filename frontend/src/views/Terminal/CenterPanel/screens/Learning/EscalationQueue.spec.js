import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import EscalationQueue from './EscalationQueue.vue';

const item = (id, title, extra = {}) => ({ id, title, description: 'about ' + title, target_type: 'agent', ...extra });
const items = () => [item('a', 'Tighten the prompt'), item('b', 'Add a retry', { target_type: 'workflow' }), item('c', 'Drop a tool')];
const button = (w, text) => w.findAll('button').find((b) => b.text() === text || b.text().startsWith(text));

describe('EscalationQueue', () => {
  it('accepts or rejects a single row without asking', async () => {
    const w = mount(EscalationQueue, { props: { items: items() } });
    const row = w.findAll('.row')[1];
    await button(row, 'Accept').trigger('click');
    await button(row, 'Reject').trigger('click');
    expect(w.emitted('accept')).toEqual([[['b']]]);
    expect(w.emitted('reject')).toEqual([[['b']]]);
    expect(w.emitted('select')).toBeUndefined(); // a verb is not a selection
  });

  it('asks once before Accept all, then accepts every shown row', async () => {
    const w = mount(EscalationQueue, { props: { items: items() } });
    await button(w, 'Accept all (3)').trigger('click');
    expect(w.emitted('accept')).toBeUndefined();
    expect(w.find('.confirm').text()).toContain('Accept 3 actions?');
    await button(w.find('.confirm'), 'Confirm').trigger('click');
    expect(w.emitted('accept')).toEqual([[['a', 'b', 'c']]]);
    expect(w.find('.confirm').exists()).toBe(false);
  });

  it('Reject all can be cancelled', async () => {
    const w = mount(EscalationQueue, { props: { items: items() } });
    await button(w, 'Reject all').trigger('click');
    await button(w.find('.confirm'), 'Cancel').trigger('click');
    expect(w.emitted('reject')).toBeUndefined();
  });

  it('a selection turns the bulk verbs into Accept N / Reject N for exactly that selection', async () => {
    const w = mount(EscalationQueue, { props: { items: items() } });
    await w.findAll('.row-check')[0].setValue(true);
    await w.findAll('.row-check')[2].setValue(true);
    expect(button(w, 'Accept all')).toBeUndefined();
    await button(w, 'Reject 2').trigger('click');
    await button(w.find('.confirm'), 'Confirm').trigger('click');
    expect(w.emitted('reject')).toEqual([[['a', 'c']]]);
  });

  it('search narrows the list, and "all" means all that are shown', async () => {
    const w = mount(EscalationQueue, { props: { items: items() } });
    await w.find('input[type="search"]').setValue('workflow');
    expect(w.findAll('.row')).toHaveLength(1);
    await button(w, 'Accept all (1)').trigger('click');
    await button(w.find('.confirm'), 'Confirm').trigger('click');
    expect(w.emitted('accept')).toEqual([[['b']]]);
  });

  it('select-all toggles every shown row', async () => {
    const w = mount(EscalationQueue, { props: { items: items() } });
    await w.find('.check-all input').setValue(true);
    expect(button(w, 'Accept 3')).toBeTruthy();
    await w.find('.check-all input').setValue(false);
    expect(button(w, 'Accept all (3)')).toBeTruthy();
  });

  it('forgets selected ids that left the queue', async () => {
    const w = mount(EscalationQueue, { props: { items: items() } });
    await w.findAll('.row-check')[0].setValue(true);
    await w.findAll('.row-check')[1].setValue(true);
    await w.setProps({ items: items().slice(1) });
    expect(button(w, 'Accept 1')).toBeTruthy();
  });

  it('clicking a row selects it for the right panel', async () => {
    const w = mount(EscalationQueue, { props: { items: items() } });
    await w.findAll('.row')[2].trigger('click');
    expect(w.emitted('select')[0][0]).toMatchObject({ id: 'c' });
  });

  it('shows batch progress with a stop, and disables verbs while busy', async () => {
    const w = mount(EscalationQueue, { props: { items: items(), busy: true, progress: { verb: 'Accepting', done: 50, total: 384, stoppable: true } } });
    expect(w.find('.progress').text()).toContain('Accepting 50 of 384');
    await button(w.find('.progress'), 'Stop').trigger('click');
    expect(w.emitted('stop')).toHaveLength(1);
    expect(button(w, 'Accept all').attributes('disabled')).toBeDefined();
  });

  it('says so when nothing is waiting', () => {
    expect(mount(EscalationQueue, { props: { items: [] } }).text()).toContain('Nothing is waiting for you.');
  });
});
