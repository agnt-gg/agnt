// Context Management indicator.
//
// It previously read "Active" for exactly 5 seconds and then reverted to
// "Idle" forever. On a large-window model no trimming is ever needed, so the
// only state a user ever saw was "Idle" - which implies something is waiting
// to happen rather than that the request simply fits.
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SystemHealthPanel from './SystemHealthPanel.vue';

const row = (w, label) =>
  w.findAll('.health-item').find((r) => r.text().includes(label));

describe('Context Management indicator', () => {
  it('says "Not needed" when nothing has been trimmed', () => {
    const w = mount(SystemHealthPanel, { props: { contextManaged: false, lastManaged: null } });
    const r = row(w, 'Context Management');
    expect(r.text()).toContain('Not needed');
    expect(r.text()).not.toContain('Idle');
  });

  it('treats "nothing to trim" as healthy, not as an idle/degraded state', () => {
    const w = mount(SystemHealthPanel, { props: { contextManaged: false, lastManaged: null } });
    expect(row(w, 'Context Management').classes()).toContain('healthy');
  });

  it('reports the reduction once a trim has happened', () => {
    const w = mount(SystemHealthPanel, {
      props: { contextManaged: true, lastManaged: { reduction: 12400 } },
    });
    expect(row(w, 'Context Management').text()).toContain('trimmed 12.4k');
  });

  it('keeps reporting it after the live flag clears (no 5s blink)', () => {
    const w = mount(SystemHealthPanel, {
      props: { contextManaged: false, lastManaged: { reduction: 12400 } },
    });
    const r = row(w, 'Context Management');
    expect(r.text()).toContain('trimmed 12.4k');
    expect(r.classes()).toContain('active');
  });

  it('scales a large reduction to M', () => {
    const w = mount(SystemHealthPanel, {
      props: { contextManaged: false, lastManaged: { reduction: 2_400_000 } },
    });
    expect(row(w, 'Context Management').text()).toContain('trimmed 2.4M');
  });

  it('ignores a zero-reduction record', () => {
    const w = mount(SystemHealthPanel, {
      props: { contextManaged: false, lastManaged: { reduction: 0 } },
    });
    expect(row(w, 'Context Management').text()).toContain('Not needed');
  });

  it('leaves the other health rows untouched', () => {
    const w = mount(SystemHealthPanel, {
      props: { errorsCaught: 2, toolTruncations: 1, toolsLoadedCount: 7,
               cacheMetrics: { hitRate: '86.5' } },
    });
    expect(row(w, 'Error Recovery').text()).toContain('2 handled');
    expect(row(w, 'Tool Output').text()).toContain('1 managed');
    expect(row(w, 'Tool Calls').text()).toContain('7 this session');
    expect(row(w, 'Cache').text()).toContain('86.5% hit rate');
  });
});
