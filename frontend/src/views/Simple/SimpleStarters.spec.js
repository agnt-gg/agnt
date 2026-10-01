import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import SimpleStarters from './SimpleStarters.vue';
import { STARTERS, STARTER_INTERVAL_MS } from './simpleStarters.js';

const labels = (w) => w.findAll('.simple-starter-label').map((n) => n.text());
const laneOf = (label) => STARTERS.find((s) => s[1] === label)[0];

function mountIt() {
  return mount(SimpleStarters, { global: { directives: { tooltip: {} } }, attachTo: document.body });
}

describe('SimpleStarters', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn(() => ({ matches: false }));
  });
  afterEach(() => vi.useRealTimers());

  it('shows three ideas from three different lanes, each with its lane tag', () => {
    const w = mountIt();
    const shown = labels(w);
    expect(shown).toHaveLength(3);
    expect(new Set(shown.map(laneOf)).size).toBe(3);
    expect(w.findAll('.simple-starter-tag svg')).toHaveLength(3);
    w.unmount();
  });

  it('a card sends its full prompt, not its short label', async () => {
    const w = mountIt();
    const label = labels(w)[0];
    await w.find('.simple-starter').trigger('click');
    expect(w.emitted('pick')[0][0]).toBe(STARTERS.find((s) => s[1] === label)[2]);
    w.unmount();
  });

  it('changes exactly one card every interval', async () => {
    const w = mountIt();
    const before = labels(w);
    vi.advanceTimersByTime(STARTER_INTERVAL_MS);
    await w.vm.$nextTick();
    const after = labels(w);
    expect(after.filter((l, i) => l !== before[i])).toHaveLength(1);
    w.unmount();
  });

  it('holds still under the pointer, and under reduced motion', async () => {
    const w = mountIt();
    const before = labels(w);
    await w.find('.simple-starters').trigger('mouseenter');
    vi.advanceTimersByTime(STARTER_INTERVAL_MS * 3);
    await w.vm.$nextTick();
    expect(labels(w)).toEqual(before);
    await w.find('.simple-starters').trigger('mouseleave');
    window.matchMedia = vi.fn(() => ({ matches: true }));
    vi.advanceTimersByTime(STARTER_INTERVAL_MS * 3);
    await w.vm.$nextTick();
    expect(labels(w)).toEqual(before);
    w.unmount();
  });

  it('More ideas replaces all three and restarts the clock', async () => {
    const w = mountIt();
    const before = labels(w);
    vi.advanceTimersByTime(STARTER_INTERVAL_MS - 100);
    await w.find('.simple-starters-more').trigger('click');
    const after = labels(w);
    expect(after.some((l, i) => l !== before[i])).toBe(true);
    expect(new Set(after.map(laneOf)).size).toBe(3);
    vi.advanceTimersByTime(200); // the old tick would have fired here
    await w.vm.$nextTick();
    expect(labels(w)).toEqual(after);
    w.unmount();
  });

  it('stops its timer when it leaves (no work after the first message)', () => {
    const w = mountIt();
    w.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
