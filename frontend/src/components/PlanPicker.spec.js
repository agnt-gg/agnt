import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PlanPicker from './PlanPicker.vue';

const tab = (w, name) => w.findAll('.tab').find((t) => t.text().includes(name));
const cta = (w) => w.find('.btn-primary');

describe('PlanPicker', () => {
  it('shows every plan as a tab and the selected plan in full', async () => {
    const w = mount(PlanPicker);
    expect(w.findAll('.tab').map((t) => t.find('.tab-name').text())).toEqual(['AGNT Pro', 'Pro + Always-On', 'AGNT Team']);
    expect(w.find('.tagline').text()).toBe('Your agent, hosted. Everything included.');
    await tab(w, 'AGNT Team').trigger('click');
    expect(w.find('.meta').text()).toContain('3 seats');
  });

  it('emits the chosen plan and interval; checkout is the host’s business', async () => {
    const w = mount(PlanPicker);
    await tab(w, 'Pro + Always-On').trigger('click');
    await w.find('.interval input').setValue(true);
    await cta(w).trigger('click');
    expect(w.emitted('choose')).toEqual([[{ planType: 'always_on', interval: 'yearly' }]]);
  });

  it('marks the current plan and will not re-buy it', async () => {
    const w = mount(PlanPicker, { props: { currentPlan: 'personal' } });
    expect(tab(w, 'AGNT Pro').text()).toContain('Current');
    expect(cta(w).text()).toBe('Your current plan');
    expect(cta(w).attributes('disabled')).toBeDefined();
    await tab(w, 'AGNT Team').trigger('click');
    expect(cta(w).text()).toBe('Switch to AGNT Team');
  });

  it('shows busy, error and a gate reason', () => {
    const w = mount(PlanPicker, { props: { busy: true, error: 'Card declined', reason: 'Web search is included with AGNT Pro.' } });
    expect(cta(w).text()).toBe('Opening checkout…');
    expect(w.find('.error').text()).toBe('Card declined');
    expect(w.find('.reason').text()).toContain('Web search');
  });
});
