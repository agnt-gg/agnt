import { describe, it, expect } from 'vitest';
import { families, shelf, unlocks, asks, nextStep } from './forYouModel.js';
import { pluginIcon, providerIcon, SHIPPED_ICONS } from './brandIcons.js';

const tool = (authProvider) => ({ type: 't', schema: authProvider ? { authProvider } : {} });
const rows = [
  { name: 'gmail-plugin', displayName: 'Gmail', kind: 'app', icon: 'gmail', tools: [tool('google')] },
  { name: 'google-calendar-plugin', displayName: 'Google Calendar', kind: 'app', icon: 'calendar', tools: [tool('google')] },
  { name: 'slack-plugin', displayName: 'Slack', kind: 'app', icon: 'slack', tools: [tool('slack')] },
  { name: 'inbox', displayName: 'Inbox Triage', kind: 'pack', trustTier: 'official', tools: [tool('google')] },
  { name: 'support', displayName: 'Support', kind: 'pack', trustTier: 'official', tools: [tool('slack'), tool('notion')] },
  { name: 'calculator-plugin', displayName: 'Calculator', kind: 'utility', icon: 'calculator', tools: [tool()] },
  { name: 'sentinel', displayName: 'Sentinel', kind: 'utility', icon: 'shield-halved', tools: [tool()] },
];
const card = (id, name, extra = {}) => ({ id, kind: 'account', providerId: id, name, icon: '', status: 'connect', suggested: [], ...extra });
const cards = { yours: [], discover: [card('google', 'Google'), card('slack', 'Slack'), card('notion', 'Notion'), card('dropbox', 'Dropbox')] };

describe('brand icons', () => {
  it('ships the Google suite marks, and uses them over a manifest’s generic glyph', () => {
    for (const name of ['google-calendar', 'google-docs', 'google-sheets', 'google-meet', 'gmail', 'slack', 'notion', 'github']) expect(SHIPPED_ICONS.has(name), name).toBe(true);
    expect(pluginIcon(rows[1])).toBe('google-calendar');
    expect(pluginIcon({ name: 'google-docs-plugin', icon: 'file-lines' })).toBe('google-docs');
  });
  it('falls back to the sign-in’s brand, then the generic icon; never an unshipped name', () => {
    expect(pluginIcon({ name: 'x', icon: 'not-a-file' }, { providers: ['hubspot'] })).toBe('hubspot');
    expect(pluginIcon({ name: 'x', icon: '❄️' })).toBe('puzzle-piece');
    expect(providerIcon('microsoft365')).toBe('business-microsoft365');
    expect(providerIcon('nope')).toBeNull();
  });
});

describe('For you', () => {
  const none = new Set();
  it('families: only sign-ins something uses, Google first, with its apps and their brand icons', () => {
    const fams = families({ cards, rows, connected: none });
    expect(fams.map((f) => f.id)).toEqual(['google', 'slack', 'notion']);
    expect(fams[0].apps.map((a) => a.icon)).toEqual(['gmail', 'google-calendar']);
    expect(fams[0].icon).toBe('google');
  });
  it('shelf: a pack needs the sign-ins its tools declare; ready first', () => {
    const items = shelf({ rows, connected: new Set(['google']) });
    expect(items.map((s) => [s.row.name, s.ready, s.missing])).toEqual([
      ['inbox', true, []], ['calculator-plugin', true, []], ['sentinel', true, []], ['support', false, ['slack', 'notion']],
    ]);
  });
  it('unlocks counts only packs this one connection would finish', () => {
    const items = shelf({ rows, connected: none });
    expect(unlocks('google', items, none)).toBe(1);
    expect(unlocks('slack', items, none)).toBe(0);
    expect(unlocks('slack', items, new Set(['notion']))).toBe(1);
  });
  it('asks: connected apps’ asks, plus no-setup asks for utilities on the Market', () => {
    expect(asks({ connected: none, rows }).forApps).toEqual([]);
    expect(asks({ connected: none, rows }).noSetup.map((a) => a.plugin)).toEqual(['sentinel', 'calculator-plugin']);
    expect(asks({ connected: new Set(['google']), rows }).forApps[0]).toMatchObject({ provider: 'google', icon: 'google' });
  });
  it('next step: connect the lead family first; then add a ready pack that uses a connection', () => {
    const fams = families({ cards, rows, connected: none });
    expect(nextStep({ families: fams, items: shelf({ rows, connected: none }), connected: none })).toMatchObject({ type: 'connect', family: { id: 'google' } });
    const on = new Set(['google']);
    expect(nextStep({ families: families({ cards, rows, connected: on }), items: shelf({ rows, connected: on }), connected: on })).toMatchObject({ type: 'install', item: { row: { name: 'inbox' } } });
  });
});
