/**
 * The Apps sidebar, shared by the Apps screen and Plugin Forge (PluginsScreen).
 *
 * Your plugins leads (one card per thing you connect), then Email and Webhooks,
 * which are headline features and never behind a caption. Plugin Forge is a row
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
  it('is one list: Your plugins, Email and Webhooks first, with no Advanced caption', () => {
    const w = mount(ConnectorsPanel);
    expect(rowText(w)).toEqual(['Your plugins', 'Email Inbox', 'Webhooks', 'MCP Servers', 'Plugin Forge', 'Keys & Sign-ins']);
    expect(w.findAll('h4')).toHaveLength(0);
    expect(w.text()).not.toMatch(/Advanced/);
    expect(w.text()).not.toMatch(/AI Provider|App Forge|Your apps/);
  });

  it('highlights Your plugins by default', () => {
    const w = mount(ConnectorsPanel, { props: { screenName: 'ConnectorsScreen' } });
    expect(w.findAll('.nav-item.active').map((b) => b.attributes('data-nav'))).toEqual(['apps']);
  });

  it('on the Apps screen, a section row switches the section; Plugin Forge opens its screen', async () => {
    const w = mount(ConnectorsPanel, { props: { screenName: 'ConnectorsScreen' } });
    await w.get('[data-nav="mcp-servers"]').trigger('click');
    await w.get('[data-nav="plugins"]').trigger('click');
    expect(w.emitted('panel-action')).toEqual([
      ['connectors-nav', 'mcp-servers'],
      ['navigate', { screen: 'PluginsScreen' }],
    ]);
  });

  it('on Plugin Forge, Plugin Forge is the highlighted row and nothing else is', () => {
    setInnerSection('oauth');
    const w = mount(ConnectorsPanel, { props: { screenName: 'PluginsScreen' } });
    expect(w.findAll('.nav-item.active').map((b) => b.attributes('data-nav'))).toEqual(['plugins']);
  });

  it('from Plugin Forge, a section row goes back to Apps on that section', async () => {
    const w = mount(ConnectorsPanel, { props: { screenName: 'PluginsScreen' } });
    await w.get('[data-nav="webhooks"]').trigger('click');
    expect(w.emitted('panel-action')).toEqual([['navigate', { screen: 'ConnectorsScreen', opts: { section: 'webhooks' } }]]);
  });
});
