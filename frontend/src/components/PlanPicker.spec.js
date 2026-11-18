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

  it('a monthly subscriber can switch their plan to annual billing, with a code', async () => {
    const w = mount(PlanPicker, { props: { currentPlan: 'personal', currentInterval: 'monthly', suggest: 'personal' } });
    expect(cta(w).text()).toBe('Your current plan');
    expect(w.find('.code').exists()).toBe(false);
    await w.find('.interval input').setValue(true);
    expect(cta(w).text()).toBe('Switch to annual billing');
    expect(cta(w).attributes('disabled')).toBeUndefined();
    await w.find('.code').setValue('  SAVE25 ');
    await cta(w).trigger('click');
    expect(w.emitted('choose')).toEqual([[{ planType: 'personal', interval: 'yearly', promoCode: 'SAVE25' }]]);
  });

  it('a lower plan keeps monthly billing: annual is off and there is no code', async () => {
    const w = mount(PlanPicker, { props: { currentPlan: 'business', currentInterval: 'monthly', suggest: 'business' } });
    await w.find('.interval input').setValue(true);
    await tab(w, 'AGNT Pro').trigger('click');
    const box = w.find('.interval input');
    expect(box.element.checked).toBe(false);
    expect(box.attributes('disabled')).toBeDefined();
    expect(w.find('.code').exists()).toBe(false);
    await cta(w).trigger('click');
    expect(w.emitted('choose')).toEqual([[{ planType: 'personal', interval: 'monthly' }]]);
  });

  it('yearly billing stays yearly, and a change from it carries no code', async () => {
    const w = mount(PlanPicker, { props: { currentPlan: 'personal', currentInterval: 'yearly', suggest: 'personal' } });
    const box = w.find('.interval input');
    expect(box.element.checked).toBe(true);
    expect(box.attributes('disabled')).toBeDefined();
    expect(cta(w).text()).toBe('Your current plan');
    await tab(w, 'AGNT Team').trigger('click');
    expect(w.find('.code').exists()).toBe(false);
    await cta(w).trigger('click');
    expect(w.emitted('choose')).toEqual([[{ planType: 'business', interval: 'yearly' }]]);
  });

  it("Team's extra seats are quoted by the billing period", async () => {
    const w = mount(PlanPicker, { props: { suggest: 'business' } });
    expect(w.find('.meta').text()).toContain('+$25/mo each extra');
    await w.find('.interval input').setValue(true);
    expect(w.find('.meta').text()).toContain('+$250/yr each extra');
    const yearlyTeam = mount(PlanPicker, { props: { currentPlan: 'business', currentInterval: 'yearly', suggest: 'business' } });
    expect(yearlyTeam.find('.meta').text()).toContain('+$250/yr each extra');
  });

  it("an offer's link opens a monthly plan on annual billing with its code filled in", async () => {
    const w = mount(PlanPicker, { props: { currentPlan: 'business', currentInterval: 'monthly', suggest: 'business', presetYearly: true, presetCode: 'BLACKFRIDAY' } });
    expect(w.find('.interval input').element.checked).toBe(true);
    expect(w.find('.code').element.value).toBe('BLACKFRIDAY');
    expect(cta(w).text()).toBe('Switch to annual billing');
    await cta(w).trigger('click');
    expect(w.emitted('choose')).toEqual([[{ planType: 'business', interval: 'yearly', promoCode: 'BLACKFRIDAY' }]]);
  });

  it("an offer's link opens a free account on annual billing, with a note saying where the code goes", async () => {
    const w = mount(PlanPicker, { props: { presetYearly: true, presetCode: 'BLACKFRIDAY', note: 'BLACKFRIDAY is applied at checkout.' } });
    expect(w.find('.interval input').element.checked).toBe(true);
    expect(w.find('.code').exists()).toBe(false);
    expect(w.find('.note').text()).toBe('BLACKFRIDAY is applied at checkout.');
    await cta(w).trigger('click');
    expect(w.emitted('choose')).toEqual([[{ planType: 'personal', interval: 'yearly' }]]);
  });

  it('a subscriber is not told checkout is opening', () => {
    const w = mount(PlanPicker, { props: { currentPlan: 'personal', currentInterval: 'monthly', busy: true } });
    expect(cta(w).text()).toBe('Working…');
  });
});
