/**
 * The Apps sidebar, shared by the Apps screen and App Forge (PluginsScreen).
 *
 * Your apps leads (one card per thing you connect), then Email and Webhooks,
 * which are headline features and never behind a caption. App Forge is a row
 * that opens its own screen, and the sidebar stays on screen while you are
 * there. AI models are not here: they are Settings › AI Models.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vuex', () => ({ useStore: () => ({ getters: {}, state: { appAuth: { allProviders: [] } } }) }));

import ConnectorsPanel from './ConnectorsPanel.vue';
import { setInnerSection } from '@/canvas/innerSection.js';

const rowText = (w) => w.findAll('.nav-item').map((b) => b.text().replace(/\s*\[PRO\]/, '').trim());

beforeEach(() => setInnerSection(null));

describe('Apps sidebar', () => {
  it('is one list: Your apps, Email and Webhooks first, with no Advanced caption', () => {
    const w = mount(ConnectorsPanel);
    expect(rowText(w)).toEqual(['Your apps', 'Email Inbox', 'Webhooks', 'MCP Servers', 'App Forge', 'Keys & Sign-ins']);
    expect(w.findAll('h4')).toHaveLength(0);
    expect(w.text()).not.toMatch(/Advanced/);
    expect(w.text()).not.toMatch(/AI Provider|Plugin/);
  });

  it('highlights Your apps by default', () => {
    const w = mount(ConnectorsPanel, { props: { screenName: 'ConnectorsScreen' } });
    expect(w.findAll('.nav-item.active').map((b) => b.attributes('data-nav'))).toEqual(['apps']);
  });

  it('on the Apps screen, a section row switches the section; App Forge opens its screen', async () => {
    const w = mount(ConnectorsPanel, { props: { screenName: 'ConnectorsScreen' } });
    await w.get('[data-nav="mcp-servers"]').trigger('click');
    await w.get('[data-nav="plugins"]').trigger('click');
    expect(w.emitted('panel-action')).toEqual([
      ['connectors-nav', 'mcp-servers'],
      ['navigate', { screen: 'PluginsScreen' }],
    ]);
  });

  it('on App Forge, App Forge is the highlighted row and nothing else is', () => {
    setInnerSection('oauth');
    const w = mount(ConnectorsPanel, { props: { screenName: 'PluginsScreen' } });
    expect(w.findAll('.nav-item.active').map((b) => b.attributes('data-nav'))).toEqual(['plugins']);
  });

  it('from App Forge, a section row goes back to Apps on that section', async () => {
    const w = mount(ConnectorsPanel, { props: { screenName: 'PluginsScreen' } });
    await w.get('[data-nav="webhooks"]').trigger('click');
    expect(w.emitted('panel-action')).toEqual([['navigate', { screen: 'ConnectorsScreen', opts: { section: 'webhooks' } }]]);
  });
});
