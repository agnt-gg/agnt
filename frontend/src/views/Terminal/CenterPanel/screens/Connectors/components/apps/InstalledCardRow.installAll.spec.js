import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import InstalledCardRow from './InstalledCardRow.vue';

const stubs = { SvgIcon: true, AppsIcon: true };
const mountRow = (card) => mount(InstalledCardRow, { props: { card, rows: new Map(), notices: new Map() }, global: { stubs, directives: { tooltip: {} } } });
const google = (installed, suggested) => ({
  id: 'google', kind: 'account', providerId: 'google', name: 'Google', status: 'ready', connectionType: 'oauth',
  apps: installed.map((n) => ({ name: n, displayName: 'Google ' + n })), suggested: suggested.map((n) => ({ name: n, displayName: 'Google ' + n })),
});

// A sign-in with several plugins offers all of them at once.
describe('Install all on a connection card', () => {
  it('offers the plugins not installed yet, and asks for them all at once', async () => {
    const row = mountRow(google(['gmail'], ['calendar', 'drive', 'sheets']));
    const button = row.find('[data-action="install-all"]');
    expect(button.text()).toBe('Install all 3');
    await button.trigger('click');
    expect(row.emitted('install-all')[0][0].suggested.map((s) => s.name)).toEqual(['calendar', 'drive', 'sheets']);
  });
  it('is not offered when everything is installed, or the sign-in has only one plugin', () => {
    expect(mountRow(google(['gmail', 'calendar'], [])).find('[data-action="install-all"]').exists()).toBe(false);
    expect(mountRow(google([], ['gmail'])).find('[data-action="install-all"]').exists()).toBe(false);
  });
});
