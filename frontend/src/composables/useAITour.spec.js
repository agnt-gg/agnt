import { describe, expect, it } from 'vitest';
import { stepsToPopupConfig } from './useAITour.js';

describe('stepsToPopupConfig', () => {
  it('ends the tour on "Got it", not "Next" — a one-step highlight included', () => {
    expect(stepsToPopupConfig([{ title: 'Apps', content: 'x', targetSelector: '#a' }])[0].buttonText).toBe('Got it');
    const three = stepsToPopupConfig([{ title: 'a' }, { title: 'b' }, { title: 'c' }]);
    expect(three.map((s) => s.buttonText)).toEqual([undefined, undefined, 'Got it']);
  });

  it('keeps a step\'s own button text', () => {
    expect(stepsToPopupConfig([{ title: 'a', buttonText: 'Open it' }])[0].buttonText).toBe('Open it');
  });

  it('anchors a targeted step and centres an untargeted one', () => {
    const [anchored, free] = stepsToPopupConfig([{ title: 'a', targetSelector: '#x', position: 'right' }, { title: 'b' }]);
    expect(anchored).toMatchObject({ target: '#x', position: 'right' });
    expect(free).toMatchObject({ target: undefined, position: 'center' });
  });
});
