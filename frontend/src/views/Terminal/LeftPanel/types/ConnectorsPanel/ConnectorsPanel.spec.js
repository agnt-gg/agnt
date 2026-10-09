/**
 * The Plugins sidebar, shared by the Plugins screen and Plugin Forge (PluginsScreen).
 *
 * Plugins leads (one card per thing you connect), then Email and Webhooks,
 * which are headline features and never behind a caption. Plugin Forge is NOT
 * a row: it is the toolbar tab beside PLUGINS, like every other forge. AI
 * models are not here: they are Settings › AI Models.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';

vi.mock('vuex', () => ({ useStore: () => ({ getters: {}, state: { appAuth: { allProviders: [] } } }) }));

import ConnectorsPanel from './ConnectorsPanel.vue';
import { setInnerSection } from '@/canvas/innerSection.js';

const rowText = (w) => w.findAll('.nav-item').map((b) => b.text().replace(/\s*\[PRO\]/, '').trim());

beforeEach(() => setInnerSection(null));

describe('Plugins sidebar', () => {
  it('is one list: Plugins, Email and Webhooks first, with no Advanced caption and no Plugin Forge row', () => {
    const w = mount(ConnectorsPanel);
    expect(rowText(w)).toEqual(['Plugins', 'Email Inbox', 'Webhooks', 'MCP Servers', 'Vault']);
    expect(w.findAll('h4')).toHaveLength(0);
    expect(w.text()).not.toMatch(/Advanced/);
    expect(w.text()).not.toMatch(/AI Provider|App Forge|Your apps|Your plugins|Plugin Forge/);
  });

  it('highlights Plugins by default', () => {
    const w = mount(ConnectorsPanel, { props: { screenName: 'ConnectorsScreen' } });
    expect(w.findAll('.nav-item.active').map((b) => b.attributes('data-nav'))).toEqual(['apps']);
  });

  it('on the Plugins screen, a section row switches the section', async () => {
    const w = mount(ConnectorsPanel, { props: { screenName: 'ConnectorsScreen' } });
    await w.get('[data-nav="mcp-servers"]').trigger('click');
    expect(w.emitted('panel-action')).toEqual([['connectors-nav', 'mcp-servers']]);
  });

  it('on Plugin Forge, no catalog row is highlighted', () => {
    setInnerSection('oauth');
    const w = mount(ConnectorsPanel, { props: { screenName: 'PluginsScreen' } });
    expect(w.findAll('.nav-item.active')).toHaveLength(0);
  });

  it('from Plugin Forge, a section row goes back to Plugins on that section', async () => {
    const w = mount(ConnectorsPanel, { props: { screenName: 'PluginsScreen' } });
    await w.get('[data-nav="webhooks"]').trigger('click');
    expect(w.emitted('panel-action')).toEqual([['navigate', { screen: 'ConnectorsScreen', opts: { section: 'webhooks' } }]]);
  });
});
