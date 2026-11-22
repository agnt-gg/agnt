import { describe, it, expect } from 'vitest';
import { studioPanels, panelRowTarget } from './appsStudioPanels.js';

const summary = {
  section: 'connections',
  counts: { connections: 14, plugins: 8, mcp: 0, triggers: 0 },
  needsYou: 2,
  broken: [
    { id: 'calendly', name: 'Calendly', problem: 'The sign-in expired', status: 'reconnect' },
    { id: 'notion', name: 'Notion', status: 'connect' },
  ],
};

describe('the Apps page between Studio\'s panels', () => {
  it('the left is a collection overview: stats and the sections, the current one lit (what needs you is on the right)', () => {
    const { left } = studioPanels(summary);
    expect(left.title).toBe('Plugins');
    expect(left.stats).toEqual([
      { label: 'Connections', value: 14 },
      { label: 'Need you', value: 2, tone: 'bad' },
      { label: 'Plugins', value: 8 },
      { label: 'MCP servers', value: 0 },
    ]);
    expect(left.lists).toHaveLength(1);
    const [sections] = left.lists;
    expect(sections.items.map((i) => [i.id, i.meta, !!i.active])).toEqual([
      ['section:connections', '14', true], ['section:plugins', '8', false], ['section:mcp', '0', false], ['section:triggers', '0', false],
    ]);
  });

  it('the right starts with the section\'s one create button, then what needs you and what else it can do', () => {
    expect(studioPanels(summary).right).toEqual({
      create: { action: 'add', label: 'Add connection' },
      needs: [
        { id: 'calendly', name: 'Calendly', problem: 'The sign-in expired', cta: 'Reconnect' },
        { id: 'notion', name: 'Notion', problem: 'It stopped working', cta: 'Connect' },
      ],
      more: [{ id: 'check-all', name: 'Check every connection', cta: 'Check' }],
    });
    expect(studioPanels({ ...summary, section: 'plugins' }).right.create).toEqual({ action: 'browse', label: 'Browse Market' });
    expect(studioPanels({ ...summary, section: 'mcp' }).right.create).toEqual({ action: 'mcp-manage', label: 'Add MCP server' });
    expect(studioPanels({ ...summary, section: 'triggers' }).right.create).toEqual({ action: 'workflows', label: 'Open workflows' });
  });

  it('a calm account needs nothing, and an unknown section is Connections', () => {
    const calm = studioPanels({ counts: {}, broken: [] });
    expect(calm.left.stats[1]).toEqual({ label: 'Need you', value: 0 });
    expect(calm.right.needs).toEqual([]);
    expect(calm.right.create.action).toBe('add');
    expect(studioPanels().left.lists[0].items[0].active).toBe(true);
  });

  it('reads a row back to what it does', () => {
    expect(panelRowTarget('section:mcp')).toEqual({ kind: 'section', section: 'mcp' });
    expect(panelRowTarget('fix:google:work')).toEqual({ kind: 'fix', id: 'google:work' });
    expect(panelRowTarget('section:nope')).toBeNull();
    expect(panelRowTarget('')).toBeNull();
  });
});

describe('a list fits its width', () => {
  const heads = [{ id: 'name', min: 190, fr: 1.6 }, { id: 'app', min: 110, fr: 1.15, drop: 2 }, { id: 'status', min: 270, fr: 1.2 }, { id: 'used', min: 130, fr: 0.8, drop: 1 }];
  it('drops optional columns first, then shares the room instead of overflowing', async () => {
    const { listColumns } = await import('./appsModel.js');
    expect(listColumns(heads, 2000)).toMatchObject({ fits: true, template: '36px minmax(190px, 1.6fr) minmax(110px, 1.15fr) minmax(270px, 1.2fr) minmax(130px, 0.8fr) 36px' });
    // The highest drop goes first: App (2) before Used by (1).
    expect(listColumns(heads, 700).heads.map((h) => h.id)).toEqual(['name', 'status', 'used']);
    // The centre between Studio's panels: even name + status do not fit at their minimums.
    expect(listColumns(heads, 445)).toEqual({ heads: [heads[0], heads[2]], fits: false, template: '36px minmax(0px, 1.6fr) minmax(0px, 1.2fr) 36px' });
  });
});
