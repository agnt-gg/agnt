import { describe, it, expect } from 'vitest';
import {
  isBorrowedScreen,
  screenTitle,
  isFocusedPage,
  LIBRARY_TABS,
  libraryTab,
  libraryRows,
  isIconClass,
  recentConversations,
  pluginCards,
  cronLabel,
  scheduleRows,
  initialOf,
} from './focusedModel.js';
import { SECTION_ROUTES } from '@/canvas/sections.js';

describe('screens', () => {
  it('Chat is Focused\u2019s own; every other screen is borrowed Studio', () => {
    expect(isBorrowedScreen('ChatScreen')).toBe(false);
    expect(isBorrowedScreen('WorkflowForgeScreen')).toBe(true);
    expect(isBorrowedScreen('SettingsScreen')).toBe(true);
    expect(isBorrowedScreen(undefined)).toBe(false);
  });

  it('titles every rail screen the way Studio\u2019s rail does', () => {
    for (const screen of SECTION_ROUTES) {
      const t = screenTitle(screen);
      expect(t, screen).toBeTruthy();
      expect(t, screen).not.toMatch(/Screen$/);
    }
  });

  it('titles an off-rail screen readably instead of leaking the component name', () => {
    expect(screenTitle('WorkflowForgeScreen')).not.toMatch(/Screen$/);
  });

  it('knows its own pages', () => {
    expect(isFocusedPage('library')).toBe(true);
    expect(isFocusedPage('plugins')).toBe(true);
    expect(isFocusedPage('scheduled')).toBe(true);
    expect(isFocusedPage('constructor')).toBe(false);
  });
});

describe('library', () => {
  it('every tab names a store getter, a fetch action and a catalog source', () => {
    for (const t of LIBRARY_TABS) {
      expect(t.getter).toMatch(/^\w+\/\w+$/);
      expect(t.fetch).toMatch(/^\w+\/\w+$/);
      expect(t.catalogKey).toBeTruthy();
      expect(t.ask.endsWith(' ')).toBe(true); // the cursor lands after the seed
    }
    expect(libraryTab('nope')).toBe(LIBRARY_TABS[0]);
  });

  it('opens an agent exactly as Ctrl+K does (inspect on AgentsScreen)', () => {
    const rows = libraryRows('agents', [{ id: 7, name: 'Release Marshal', description: 'Tags releases' }]);
    expect(rows).toEqual([
      {
        id: 'agent:7',
        label: 'Release Marshal',
        description: 'Tags releases',
        icon: 'fas fa-robot',
        action: { type: 'inspect', kind: 'agent', id: 7, screen: 'AgentsScreen' },
      },
    ]);
  });

  it('opens a tool through its select intent on ToolsScreen', () => {
    const [row] = libraryRows('tools', [{ id: 't1', title: 'Scraper' }]);
    expect(row.action).toEqual({ type: 'screen', screen: 'ToolsScreen', opts: { select: { kind: 'tool', id: 't1' } } });
  });

  it('sorts case-insensitively and filters by name or description', () => {
    const items = [
      { id: 1, name: 'zeta', description: 'last' },
      { id: 2, name: 'Alpha', description: 'first email triage' },
      { id: 3, name: 'beta' },
    ];
    expect(libraryRows('agents', items).map((r) => r.label)).toEqual(['Alpha', 'beta', 'zeta']);
    expect(libraryRows('agents', items, 'email').map((r) => r.label)).toEqual(['Alpha']);
    expect(libraryRows('agents', items, 'nothing')).toEqual([]);
  });

  it('keeps an item\u2019s own emoji icon and survives junk input', () => {
    expect(libraryRows('agents', [{ id: 1, name: 'A', icon: '\uD83E\uDD16' }])[0].icon).toBe('\uD83E\uDD16');
    expect(libraryRows('agents', null)).toEqual([]);
    expect(libraryRows('agents', [null, undefined])).toEqual([]);
  });

  it('never leaks the catalog\u2019s non-item rows (team library, pages) into a tab', () => {
    const rows = libraryRows('workflows', [{ id: 'w', name: 'W' }]);
    expect(rows.every((r) => r.id.startsWith('workflow:'))).toBe(true);
  });

  it('tells a class icon from a glyph', () => {
    expect(isIconClass('fas fa-robot')).toBe(true);
    expect(isIconClass('\uD83E\uDD16')).toBe(false);
    expect(isIconClass(null)).toBe(false);
  });
});

describe('recents', () => {
  const rows = [
    { id: 'a', title: 'Older', updated_at: '2026-09-01T00:00:00Z' },
    { id: 'b', title: 'Newer', updated_at: '2026-09-30T00:00:00Z' },
    { id: 'c', title: '', created_at: '2026-09-15T00:00:00Z' },
    null,
    { title: 'no id' },
  ];

  it('is newest first, titled, and skips malformed rows', () => {
    expect(recentConversations(rows).map((r) => [r.id, r.title])).toEqual([
      ['b', 'Newer'],
      ['c', 'Untitled chat'],
      ['a', 'Older'],
    ]);
  });

  it('filters by title and honours the limit', () => {
    expect(recentConversations(rows, 'old').map((r) => r.id)).toEqual(['a']);
    expect(recentConversations(rows, '', 1).map((r) => r.id)).toEqual(['b']);
  });

  it('marks unread only when there is a watermark and activity after it', () => {
    const [r] = recentConversations([{ id: 'x', title: 't', updated_at: '2026-09-02', last_read_at: '2026-09-01' }]);
    expect(r.unread).toBe(true);
    const [never] = recentConversations([{ id: 'y', title: 't', updated_at: '2026-09-02', last_read_at: null }]);
    expect(never.unread).toBe(false); // null watermark is NOT unread (see contentOutputs)
  });
});

describe('plugins', () => {
  const providers = [
    { id: 'Slack', name: 'Slack', connectionType: 'oauth' },
    { id: 'openai', name: 'OpenAI', connectionType: 'apikey' },
    { id: 'notion', name: 'Notion' },
    { id: 'slack', name: 'Slack dup' },
  ];

  it('splits connected from available, case-insensitively, without duplicates', () => {
    const { connected, available } = pluginCards(providers, ['SLACK', 'openai']);
    expect(connected.map((c) => [c.id, c.status])).toEqual([
      ['openai', 'API key'],
      ['slack', 'Connected'],
    ]);
    expect(available.map((c) => c.id)).toEqual(['notion']);
  });

  it('keeps a connection the catalogue does not list', () => {
    const { connected } = pluginCards([], ['claude-code']);
    expect(connected).toEqual([{ id: 'claude-code', name: 'claude-code', icon: '', connected: true, status: 'Connected' }]);
  });

  it('filters by name', () => {
    expect(pluginCards(providers, [], 'noti').available.map((c) => c.id)).toEqual(['notion']);
  });
});

describe('scheduled', () => {
  it.each([
    ['0 * * * *', 'Every hour'],
    ['15 * * * *', 'Every hour at :15'],
    ['30 9 * * *', 'Every day at 09:30'],
    ['0 8 * * MON-FRI', 'Weekdays at 08:00'],
    ['0 8 * * 1-5', 'Weekdays at 08:00'],
    ['0 17 * * FRI', 'Every Friday at 17:00'],
    ['0 17 * * 0', 'Every Sunday at 17:00'],
    ['0 6 1 * *', 'Monthly on day 1 at 06:00'],
    ['*/5 * * * *', '*/5 * * * *'],
    ['nonsense', 'nonsense'],
    ['', 'Custom schedule'],
  ])('cronLabel(%j) = %j', (cron, label) => {
    expect(cronLabel(cron)).toBe(label);
  });

  it('enabled first, soonest first; each opens where it is managed', () => {
    const rows = scheduleRows([
      { id: 1, name: 'Paused', cron: '0 9 * * *', enabled: false },
      { id: 2, name: 'Later', cron: '0 9 * * *', enabled: true, next_run: '2026-10-05T09:00:00Z' },
      { id: 3, name: 'Sooner', cron: '0 9 * * *', enabled: true, next_run: '2026-10-02T09:00:00Z', target_type: 'goal', target_id: 'g1' },
    ]);
    expect(rows.map((r) => r.label)).toEqual(['Sooner', 'Later', 'Paused']);
    expect(rows[0].action).toEqual({ type: 'inspect', kind: 'goal', id: 'g1', screen: 'GoalsScreen' });
    expect(rows[1].action).toEqual({ type: 'screen', screen: 'AutonomyScreen', opts: { section: 'schedules' } });
  });

  it('names a schedule after the goal it runs — schedules carry no name of their own', () => {
    // Real rows (measured): id, target_type, target_id, cron, next_run, enabled — no name.
    const goals = [{ id: 'g1', title: 'Weekly SEO report' }, { id: 'g2', text: 'Check the inbox' }];
    const rows = scheduleRows(
      [
        { id: 1, target_type: 'goal', target_id: 'g1', cron: '0 9 * * MON', enabled: true },
        { id: 2, target_type: 'goal', target_id: 'g2', cron: '0 9 * * *', enabled: true },
        { id: 3, target_type: 'goal', target_id: 'gone', cron: '0 9 * * *', enabled: true },
      ],
      '',
      goals,
    );
    expect(rows.map((r) => r.label).sort()).toEqual(['Check the inbox', 'Scheduled task', 'Weekly SEO report']);
  });

  it('searches by the goal name too', () => {
    const rows = scheduleRows([{ id: 1, target_type: 'goal', target_id: 'g1', cron: '0 9 * * *', enabled: true }], 'seo', [{ id: 'g1', title: 'SEO report' }]);
    expect(rows).toHaveLength(1);
  });

  it('survives junk', () => {
    expect(scheduleRows(null)).toEqual([]);
    expect(scheduleRows([{ id: 9 }])[0].label).toBe('Scheduled task');
    expect(scheduleRows([{ id: 9, target_type: 'goal', target_id: 'x' }], '', null)[0].label).toBe('Scheduled task');
  });
});

it('initialOf', () => {
  expect(initialOf('nathan')).toBe('N');
  expect(initialOf('')).toBe('A');
  expect(initialOf(null)).toBe('A');
});
