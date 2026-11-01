import { describe, it, expect } from 'vitest';
import { families, shelf, unlocks, asks, nextStep } from './forYouModel.js';
import { pluginIcon, providerIcon, SHIPPED_ICONS } from './brandIcons.js';

const tool = (authProvider) => ({ type: 't', schema: authProvider ? { authProvider } : {} });
const O = { trustTier: 'official' };
const rows = [
  { ...O, name: 'gmail-plugin', displayName: 'Gmail', kind: 'app', icon: 'gmail', tools: [tool('google')] },
  { ...O, name: 'google-calendar-plugin', displayName: 'Google Calendar', kind: 'app', icon: 'calendar', tools: [tool('google')] },
  { ...O, name: 'slack-plugin', displayName: 'Slack', kind: 'app', icon: 'slack', tools: [tool('slack')] },
  { name: 'inbox', displayName: 'Inbox Triage', kind: 'pack', trustTier: 'official', tools: [tool('google')] },
  { name: 'support', displayName: 'Support', kind: 'pack', trustTier: 'official', tools: [tool('slack'), tool('notion')] },
  { ...O, name: 'calculator-plugin', displayName: 'Calculator', kind: 'utility', icon: 'calculator', tools: [tool()] },
  { ...O, name: 'sentinel', displayName: 'Sentinel', kind: 'utility', icon: 'shield-halved', tools: [tool()] },
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
    // Generic glyph names map to the nearest shipped icon; a pack falls back to the agent mark.
    expect(pluginIcon({ name: 'x', icon: 'fas fa-flask' })).toBe('magic');
    expect(pluginIcon({ name: 'x', icon: 'globe' })).toBe('web');
    expect(pluginIcon({ name: 'x', icon: 'nope', kind: 'pack' })).toBe('agent');
    expect(providerIcon('microsoft365')).toBe('business-microsoft365');
    expect(providerIcon('nope')).toBeNull();
  });
});

describe('For you', () => {
  const none = new Set();
  it('a sign-in only a private (unlisted) plugin uses is not a family', () => {
    const priv = [...rows, { name: 'agnt-site-analytics', kind: 'utility', installed: true, tools: [tool('agnt-analytics')] }];
    expect(families({ cards: { yours: [card('agnt-analytics', 'AGNT Analytics (admin)')], discover: cards.discover }, rows: priv, connected: new Set(['agnt-analytics']) }).map((f) => f.id)).not.toContain('agnt-analytics');
  });
  it('a connected credential nothing on the Market uses is not a family', () => {
    const fams = families({ cards: { yours: [card('escrow-key', 'Backup key', { status: 'ready' })], discover: cards.discover }, rows, connected: new Set(['escrow-key']) });
    expect(fams.map((f) => f.id)).not.toContain('escrow-key');
  });
  it('families: only sign-ins something uses, Google first, with its apps and their brand icons', () => {
    const fams = families({ cards, rows, connected: none });
    expect(fams.map((f) => f.id)).toEqual(['google', 'slack', 'notion']);
    expect(fams[0].apps.map((a) => a.icon)).toEqual(['gmail-color', 'google-calendar']);
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
  it('asks: a plugin’s own examples win; defaults fill in; no-setup asks are Annie on her own', () => {
    expect(asks({ connected: none, rows }).forApps).toEqual([]);
    const noSetup = asks({ connected: none, rows }).noSetup.map((a) => a.text);
    expect(noSetup).toContain('Build a one-page website for my business');
    // Never AGNT's own site, never "AI agent tools".
    for (const text of noSetup) expect(text).not.toMatch(/agnt\.gg|ai agent/i);
    const withOwn = [...rows, { ...O, name: 'gmail-pro', displayName: 'Gmail Pro', kind: 'app', installed: true, examples: ['Clean up my newsletters'], tools: [tool('google')] }];
    expect(asks({ connected: new Set(['google']), rows: withOwn }).forApps).toEqual([
      expect.objectContaining({ text: 'Clean up my newsletters', plugin: 'gmail-pro', provider: 'google' }),
    ]);
    // Each Google ask carries its own app's mark: email shows Gmail, not the Google G.
    expect(asks({ connected: new Set(['google']), rows }).forApps.map((a) => a.icon)).toEqual(['gmail-color', 'google-calendar', 'google-docs']);
    expect(asks({ connected: new Set(['slack']), rows }).forApps[0]).toMatchObject({ provider: 'slack', icon: 'slack' });
    for (const a of asks({ connected: new Set(['google', 'slack', 'github']), rows }).forApps) expect(a.text).not.toMatch(/agnt\.gg|ai agent/i);
  });
  it('a community plugin is never featured: not in the cards, the next step, the sign-ins or the asks', () => {
    const thumb = { name: 'thumbgate-mcp-firewall', displayName: 'ThumbGate', kind: 'pack', trustTier: 'community', examples: ['Block risky tools'], tools: [tool('thumbgate')] };
    const thumbFree = { ...thumb, name: 'thumbgate-free', tools: [tool()] };
    const all = [...rows, thumb, thumbFree];
    const on = new Set(['google', 'thumbgate']);
    const items = shelf({ rows: all, connected: on });
    expect(items.map((s) => s.row.name)).not.toContain('thumbgate-mcp-firewall');
    expect(items.map((s) => s.row.name)).not.toContain('thumbgate-free');
    const step = nextStep({ families: families({ cards, rows: all, connected: on }), items, connected: on });
    expect(step?.item?.row?.trustTier).toBe('official');
    expect(families({ cards: { yours: [card('thumbgate', 'ThumbGate')], discover: [] }, rows: all, connected: none }).map((f) => f.id)).not.toContain('thumbgate');
    expect(asks({ connected: on, rows: all }).forApps.map((a) => a.text)).not.toContain('Block risky tools');
  });
  it('next step: connect the lead family first; then add a ready pack that uses a connection', () => {
    const fams = families({ cards, rows, connected: none });
    expect(nextStep({ families: fams, items: shelf({ rows, connected: none }), connected: none })).toMatchObject({ type: 'connect', family: { id: 'google' } });
    const on = new Set(['google']);
    expect(nextStep({ families: families({ cards, rows, connected: on }), items: shelf({ rows, connected: on }), connected: on })).toMatchObject({ type: 'install', item: { row: { name: 'inbox' } } });
  });
});
