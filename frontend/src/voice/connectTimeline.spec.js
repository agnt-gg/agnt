import { describe, it, expect } from 'vitest';
import { createConnectTimeline } from './connectTimeline.js';

describe('connectTimeline — where the seconds went, as durations', () => {
  function timelineAt(...times) {
    let t = 0;
    const tl = createConnectTimeline(() => t);
    return {
      tl,
      advanceTo(v) {
        t = v;
      },
    };
  }

  it('reports each step as the gap since the previous mark', () => {
    const { tl, advanceTo } = timelineAt();
    advanceTo(100);
    tl.mark('mic_open');
    advanceTo(250);
    tl.mark('offer_ready');
    advanceTo(900);
    tl.mark('session_ready');

    expect(tl.durations()).toEqual([
      { name: 'mic_open', at: 100, stepMs: 100 },
      { name: 'offer_ready', at: 250, stepMs: 150 },
      { name: 'session_ready', at: 900, stepMs: 650 },
    ]);
    expect(tl.totalMs()).toBe(900);
    expect(tl.summary()).toBe('mic_open+100ms offer_ready+150ms session_ready+650ms');
  });

  it('is honest about an empty timeline', () => {
    const { tl } = timelineAt();
    expect(tl.durations()).toEqual([]);
    expect(tl.totalMs()).toBe(0);
    expect(tl.summary()).toBe('');
  });

  it('marks arriving out of expected order still report truthfully', () => {
    // goLive's mic_open mark lands from a .then() and can trail offer_ready.
    // The stopwatch records what HAPPENED, in the order it happened — it must
    // not assume the steps of the happy path.
    const { tl, advanceTo } = timelineAt();
    advanceTo(50);
    tl.mark('offer_ready');
    advanceTo(60);
    tl.mark('mic_open');
    expect(tl.durations()).toEqual([
      { name: 'offer_ready', at: 50, stepMs: 50 },
      { name: 'mic_open', at: 60, stepMs: 10 },
    ]);
  });
});
