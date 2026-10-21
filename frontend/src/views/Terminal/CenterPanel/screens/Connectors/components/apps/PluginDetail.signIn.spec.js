/**
 * Reported 2026-10-21 (AGNT One): Calendly, just installed and NOT connected,
 * opened with "Try it in chat" as its lead action. Three sections down sat
 * "Calendly · Its tools can't run until you connect · Unavailable". People
 * press the first button they see.
 *
 * A plugin that cannot run never offers "Try it in chat", and whether it can
 * run is the first section under the header.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PluginDetail from './PluginDetail.vue';

const CALENDLY = {
  name: 'calendly-plugin',
  displayName: 'Calendly Plugin',
  installed: true,
  version: '1.1.0',
  category: 'Productivity',
  tools: [{ type: 'calendly-api', schema: { title: 'Calendly API', authProvider: 'calendly' } }],
};
const signIn = (over) => ({ providerId: 'calendly', name: 'Calendly', icon: 'calendly', known: true, status: 'connect', tools: ['Calendly API'], ...over });

const render = (connections) => mount(PluginDetail, {
  props: { plugin: CALENDLY, connections },
  global: {
    stubs: { SvgIcon: true, AppsIcon: true },
    directives: { tooltip: {} },
  },
});
const leadButtons = (w) => w.find('.ap-detail-head').findAll('button').map((b) => b.text());
const sectionOrder = (w) => w.findAll('.ap-detail-body > section').map((s) => s.attributes('data-section') || (s.find('h3').exists() ? s.find('h3').text() : 'untitled'));

describe('a plugin that cannot run yet', () => {
  it('THE REPORTED STATE: sign-in unknown to this account: no "Try it in chat", a blocked lead that says why', () => {
    const w = render([signIn({ known: false })]);
    expect(w.text()).not.toContain('Try it in chat');
    const lead = w.find('[data-action="next-unavailable"]');
    expect(lead.exists()).toBe(true);
    expect(lead.attributes('disabled')).toBeDefined();
    expect(w.find('[data-testid="next-line"]').text()).toMatch(/can’t run yet: it needs a Calendly sign-in/);
    expect(w.text()).not.toContain('Chat can use its tools now');
  });

  it('sign-in it can connect: leads with Connect Calendly, never "Try it in chat"', () => {
    const w = render([signIn()]);
    expect(leadButtons(w)).toContain('Connect Calendly');
    expect(w.text()).not.toContain('Try it in chat');
    expect(w.text()).toContain('Chat can use its tools once its sign-in is connected.');
  });

  it('whether it can run is the FIRST section under the header', () => {
    for (const state of [signIn(), signIn({ known: false }), signIn({ status: 'connected' })]) {
      expect(sectionOrder(render([state]))[0]).toBe('sign-in');
    }
  });
});

describe('a plugin that can run', () => {
  it('connected: leads with "Try it in chat" and says chat can use it now', () => {
    const w = render([signIn({ status: 'connected' })]);
    expect(w.find('[data-action="try"]').exists()).toBe(true);
    expect(w.text()).toContain('Chat can use its tools now.');
  });
});
