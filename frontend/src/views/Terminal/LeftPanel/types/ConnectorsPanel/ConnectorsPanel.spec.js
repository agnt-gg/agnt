/**
 * The Apps sidebar, shared by the Apps screen and the Plugins screen.
 *
 * Reported: Plugins was a tab in the toolbar while AI Providers, API / OAuth,
 * Emails and the rest lived in the left sidebar. It is now a sidebar row like
 * them, and the sidebar stays on screen while you are on Plugins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vuex', () => ({ useStore: () => ({ getters: {}, state: { appAuth: { allProviders: [] } } }) }));

import ConnectorsPanel from './ConnectorsPanel.vue';
import { setInnerSection } from '@/canvas/innerSection.js';

const rowText = (w) => w.findAll('.nav-item').map((b) => b.text().replace(/\s*\[PRO\]/, '').trim());

beforeEach(() => setInnerSection(null));

describe('Apps sidebar', () => {
  it('lists Plugins beside the connections', () => {
    const w = mount(ConnectorsPanel);
    expect(rowText(w)).toEqual(['AI Providers', 'API / OAuth', 'Emails', 'MCP', 'Webhooks', 'Plugins']);
  });

  it('on the Apps screen, a section row switches the section; Plugins opens its screen', async () => {
    const w = mount(ConnectorsPanel, { props: { screenName: 'ConnectorsScreen' } });
    await w.get('[data-nav="mcp-servers"]').trigger('click');
    await w.get('[data-nav="plugins"]').trigger('click');
    expect(w.emitted('panel-action')).toEqual([
      ['connectors-nav', 'mcp-servers'],
      ['navigate', { screen: 'PluginsScreen' }],
    ]);
  });

  it('on the Plugins screen, Plugins is the highlighted row and nothing else is', () => {
    setInnerSection('oauth');
    const w = mount(ConnectorsPanel, { props: { screenName: 'PluginsScreen' } });
    expect(w.findAll('.nav-item.active').map((b) => b.attributes('data-nav'))).toEqual(['plugins']);
  });

  it('from the Plugins screen, a section row goes back to Apps on that section', async () => {
    const w = mount(ConnectorsPanel, { props: { screenName: 'PluginsScreen' } });
    await w.get('[data-nav="webhooks"]').trigger('click');
    expect(w.emitted('panel-action')).toEqual([['navigate', { screen: 'ConnectorsScreen', opts: { section: 'webhooks' } }]]);
  });
});
