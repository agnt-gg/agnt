import { describe, it, expect } from 'vitest';
import {
  screenTitle,
  isFocusedPage,
  LIBRARY_TABS,
  libraryTab,
  libraryRows,
  isIconClass,
  glyphKind,
  recentConversations,
  connectorCards,
  connectorCard,
  categoryLabel,
  CLI_DISCONNECT_ACTIONS,
  logoSlug,
  logoUrl,
  brandHue,
  brandColor,
  logoTone,
  cronLabel,
  scheduleRows,
  parseCron,
  buildCron,
  isCron,
  memoryRows,
  initialOf,
  editAsk,
  billingSummary,
} from './focusedModel.js';
import { SECTION_ROUTES } from '@/canvas/sections.js';

describe('screens and pages', () => {
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
    for (const p of ['library', 'connectors', 'scheduled', 'memory', 'settings']) expect(isFocusedPage(p), p).toBe(true);
    // Plugins are code installed into AGNT, not connections: no Focused page.
    expect(isFocusedPage('plugins')).toBe(false);
    expect(isFocusedPage('constructor')).toBe(false);
  });
});

describe('editing in chat', () => {
  it('every edit seed is one phrasing, naming what and which, cursor after it', () => {
    expect(editAsk('plugin', 'Gmail')).toBe('Edit the Gmail plugin to ');
    expect(editAsk('workflow', '  Nightly backup ')).toBe('Edit the Nightly backup workflow to ');
    expect(editAsk('skill', '')).toBe('Edit this skill to ');
  });

  it('every Library tab has an Edit seed', () => {
    for (const t of LIBRARY_TABS) {
      expect(editAsk(t.noun, 'X'), t.id).toBe(`Edit the X ${t.noun} to `);
    }
  });
});

describe('billing', () => {
  it('a free account is offered an upgrade, nothing to cancel', () => {
    expect(billingSummary('free', null)).toMatchObject({ isFree: true, plan: 'Community Core', status: 'Free plan', renewsAt: 0, canCancel: false, canReactivate: false });
    expect(billingSummary(undefined, undefined).isFree).toBe(true);
  });

  it('a paid plan shows its name, status and renewal (Stripe seconds \u2192 ms)', () => {
    expect(billingSummary('always_on', { currentPeriodEnd: 1_800_000_000 })).toMatchObject({
      isFree: false, plan: 'Pro + Always-On', status: 'Active', renewsAt: 1_800_000_000_000, renewLabel: 'Renews', canCancel: true, canReactivate: false,
    });
  });

  it('a canceling plan can be reactivated and says when access ends', () => {
    expect(billingSummary('personal', { cancelAtPeriodEnd: true, currentPeriodEnd: 1 })).toMatchObject({ status: 'Canceling', renewLabel: 'Access until', canCancel: false, canReactivate: true });
  });

  it('past due and unknown plans are named, not hidden', () => {
    expect(billingSummary('business', { planStatus: 'past_due' }).status).toBe('Past due');
    expect(billingSummary('mystery', {}).plan).toBe('Mystery');
  });
});

describe('library', () => {
  it('every store-backed tab names a getter, a fetch action and a catalog source; Files is the disk', () => {
    for (const t of LIBRARY_TABS) {
      if (t.id === 'files') {
        expect(t.getter).toBeUndefined();
        continue;
      }
      expect(t.getter).toMatch(/^\w+\/\w+$/);
      expect(t.fetch).toMatch(/^\w+\/\w+$/);
      expect(t.catalogKey).toBeTruthy();
      expect(t.noun).toMatch(/^[a-z]+$/); // names it in the chat seeds
    }
    expect(LIBRARY_TABS.map((t) => t.id)).toEqual(['agents', 'workflows', 'tools', 'skills', 'widgets', 'files']);
    expect(libraryTab('nope')).toBe(LIBRARY_TABS[0]);
  });

  it('a row carries the item id it opens in Focused (regression: it used to carry a Studio action)', () => {
    const [row] = libraryRows('workflows', [{ id: 'w7', name: 'Nightly', description: 'Backs up', status: 'listening' }]);
    expect(row).toEqual({ id: 'workflow:w7', itemId: 'w7', label: 'Nightly', description: 'Backs up', icon: 'fas fa-project-diagram', status: 'listening' });
    expect('action' in row).toBe(false);
  });

  it('uses an agent\u2019s own avatar or icon', () => {
    expect(libraryRows('agents', [{ id: 1, name: 'A', avatar: '\uD83E\uDD16' }])[0].icon).toBe('\uD83E\uDD16');
    expect(libraryRows('agents', [{ id: 1, name: 'A', icon: '\uD83E\uDD8A' }])[0].icon).toBe('\uD83E\uDD8A');
    expect(libraryRows('agents', [{ id: 1, name: 'A' }])[0].icon).toBe('fas fa-robot');
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

  it('survives junk input and never leaks non-item catalog rows', () => {
    expect(libraryRows('agents', null)).toEqual([]);
    expect(libraryRows('agents', [null, undefined])).toEqual([]);
    expect(libraryRows('workflows', [{ id: 'w', name: 'W' }]).every((r) => r.id.startsWith('workflow:'))).toBe(true);
  });

  it('glyphKind tells the three saved icon forms apart (regression: "user-check" rendered as text)', () => {
    expect(glyphKind('fas fa-robot')).toBe('class');
    expect(glyphKind('user-check')).toBe('name');
    expect(glyphKind('robot')).toBe('name');
    expect(glyphKind('\uD83E\uDD16')).toBe('text');
    expect(glyphKind('AB')).toBe('text');
    expect(glyphKind('https://example.com/agent.png')).toBe('image');
    expect(glyphKind('data:image/png;base64,AA==')).toBe('image');
    expect(glyphKind('/api/images/agent')).toBe('image');
    expect(glyphKind('')).toBe('none');
    expect(glyphKind(null)).toBe('none');
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
    expect(never.unread).toBe(false);
  });

  // Reported: in Focused a running chat looked exactly like an unread one.
  it('marks a running chat as working, names who is speaking, and does not also call it unread', () => {
    const rows = [
      { id: 'run', title: 'Running', updated_at: '2026-09-02', last_read_at: '2026-09-01' },
      { id: 'idle', title: 'Idle', updated_at: '2026-09-02', last_read_at: '2026-09-01' },
    ];
    const live = { workingIds: new Set(['run']), speakingById: { run: { id: 'sol', name: 'Sol' } } };
    const byId = Object.fromEntries(recentConversations(rows, '', 60, null, live).map((r) => [r.id, r]));
    expect(byId.run).toMatchObject({ working: true, speaker: 'Sol', unread: false });
    expect(byId.idle).toMatchObject({ working: false, speaker: null, unread: true });
  });

  it('is idle without live state, and a running chat with no named speaker still says it is working', () => {
    const [plain] = recentConversations([{ id: 'a', title: 't' }]);
    expect(plain).toMatchObject({ working: false, speaker: null });
    const [unnamed] = recentConversations([{ id: 'a', title: 't' }], '', 60, null, { workingIds: new Set(['a']) });
    expect(unnamed).toMatchObject({ working: true, speaker: null });
  });
});

describe('connectors', () => {
  const providers = [
    { id: 'Slack', name: 'Slack', connectionType: 'oauth' },
    { id: 'openai', name: 'OpenAI', connectionType: 'apikey', instructions: 'Paste a key from platform.openai.com' },
    { id: 'notion', name: 'Notion', connectionType: 'oauth' },
    { id: 'slack', name: 'Slack dup' },
    { id: 'claude-code', name: 'Claude Code', connectionType: 'oauth' },
  ];

  it('splits connected from available, case-insensitively, without duplicates', () => {
    const { connected, available } = connectorCards(providers, ['SLACK', 'openai']);
    expect(connected.map((c) => [c.id, c.status])).toEqual([
      ['openai', 'API key'],
      ['slack', 'Connected'],
    ]);
    expect(available.map((c) => c.id)).toEqual(['claude-code', 'notion']);
  });

  it('says how each one connects, and keeps the catalogue\u2019s own id and instructions', () => {
    const { connected, available } = connectorCards(providers, ['openai']);
    expect(connected[0]).toMatchObject({ providerId: 'openai', connectionType: 'apikey', instructions: 'Paste a key from platform.openai.com' });
    expect(available.find((c) => c.id === 'claude-code').connectionType).toBe('cli');
    expect(available.find((c) => c.id === 'slack').providerId).toBe('Slack');
  });

  it('account-native AGNT is named clearly and does not ask for a key', () => {
    const card = connectorCard([], ['agnt'], 'agnt');
    expect(card).toMatchObject({ name: 'AGNT Flash', connectionType: 'account', connected: true });
  });

  it('keeps a connection the catalogue does not list', () => {
    const { connected } = connectorCards([], ['gemini-cli']);
    expect(connected[0]).toMatchObject({ id: 'gemini-cli', connected: true, connectionType: 'cli' });
  });

  it('connectorCard finds one by id, any case', () => {
    expect(connectorCard(providers, ['openai'], 'OpenAI').name).toBe('OpenAI');
    expect(connectorCard(providers, [], 'nope')).toBeNull();
  });

  // The remote catalogue (/auth/providers) is snake_case with categories as a
  // JSON string. Reading only connectionType made every remote app look like
  // it had no way to connect, so its page offered "Ask in chat" instead of
  // Connect.
  it('reads the remote catalogue\u2019s snake_case rows', () => {
    const remote = [
      { id: 'slack', name: 'Slack', connection_type: 'oauth', categories: '["communication","messaging"]', instructions: 'Send messages and manage channels.' },
      { id: 'deepseek', name: 'DeepSeek', connection_type: 'apikey', categories: '["ai"]', instructions: 'Enter your DeepSeek API key.' },
    ];
    const { connected, available } = connectorCards(remote, ['deepseek']);
    expect(available[0]).toMatchObject({ id: 'slack', connectionType: 'oauth', category: 'Communication', description: 'Send messages and manage channels.' });
    expect(connected[0]).toMatchObject({ id: 'deepseek', connectionType: 'apikey', category: 'AI', status: 'API key' });
  });

  it('tolerates a malformed categories string', () => {
    const [card] = connectorCards([{ id: 'x', name: 'X', categories: 'crm, sales' }], []).available;
    expect(card.category).toBe('CRM');
    expect(connectorCards([{ id: 'y', name: 'Y', categories: null }], []).available[0].category).toBe('');
  });

  it('names the catalogue\u2019s mixed-case categories one way', () => {
    expect(['ai', 'AI', 'vps', 'Web Scraping', 'social media', 'data-science', 'Payments', '', null].map(categoryLabel))
      .toEqual(['AI', 'AI', 'VPS', 'Web scraping', 'Social media', 'Data science', 'Payments', '', '']);
  });

  it('search matches what a card says, not just its name', () => {
    const remote = [{ id: 'slack', name: 'Slack', categories: '["messaging"]', instructions: 'Send messages' }, { id: 'notion', name: 'Notion' }];
    expect(connectorCards(remote, [], 'messaging').available.map((c) => c.id)).toEqual(['slack']);
  });

  it('logos: the Simple Icons slug for each provider, mapped where the id differs', () => {
    expect(logoSlug('slack')).toBe('slack');
    expect(logoSlug('Google-Drive')).toBe('googledrive');
    expect(logoSlug('claude-code')).toBe('claude');
    expect(logoSlug('openai-codex')).toBe('openai');
    expect(logoSlug('grokai')).toBe('x');
    expect(logoSlug('ga4')).toBe('googleanalytics');
    expect(logoSlug('hetzner-robot')).toBe('hetzner');
    expect(logoSlug('')).toBe('');
    expect(logoUrl('notion')).toBe('https://cdn.simpleicons.org/notion');
    expect(logoUrl(null)).toBe('');
  });

  it('logoTone flags marks that would vanish on no background', () => {
    expect(logoTone('github')).toBe('dark');
    expect(logoTone('grokai')).toBe('dark'); // maps to the X mark
    expect(logoTone('notion')).toBe('dark');
    expect(logoTone('mailchimp')).toBe('light');
    expect(logoTone('stripe')).toBe('');
    expect(logoTone('')).toBe('');
  });

  it('brands Simple Icons lacks fall back in their own color; others get a hue', () => {
    expect(brandColor('Slack')).toBe('#E01E5A');
    expect(brandColor('openai-codex')).toBe('#10A37F');
    expect(brandColor('some-custom-app')).toBe('');
    expect(brandColor(undefined)).toBe('');
  });

  it('brandHue is stable per name and spreads names apart', () => {
    expect(brandHue('Firecrawl')).toBe(brandHue('Firecrawl'));
    const hues = new Set(['Firecrawl', 'Apify', 'Tavily', 'Exa', 'Serper', 'Brave'].map(brandHue));
    expect(hues.size).toBeGreaterThan(4);
    for (const h of hues) expect(h >= 0 && h < 360).toBe(true);
  });

  it('every CLI provider has a disconnect action', () => {
    expect(Object.keys(CLI_DISCONNECT_ACTIONS).sort()).toEqual(['antigravity', 'claude-code', 'cursor-cli', 'gemini-cli', 'grok-build', 'openai-codex']);
  });
});

describe('scheduled', () => {
  it.each([
    ['0 * * * *', 'Every hour'],
    ['15 * * * *', 'Every hour at :15'],
    ['30 9 * * *', 'Every day at 09:30'],
    ['0 8 * * MON-FRI', 'Weekdays at 08:00'],
    ['0 17 * * FRI', 'Every Friday at 17:00'],
    ['0 6 1 * *', 'Monthly on day 1 at 06:00'],
    ['*/5 * * * *', '*/5 * * * *'],
    ['', 'Custom schedule'],
  ])('cronLabel(%j) = %j', (cron, label) => {
    expect(cronLabel(cron)).toBe(label);
  });

  it('cron round-trips through the editor fields', () => {
    for (const cron of ['30 9 * * *', '0 8 * * MON-FRI', '0 17 * * FRI', '0 6 12 * *', '15 * * * *']) {
      expect(buildCron(parseCron(cron)), cron).toBe(cron);
    }
  });

  it('anything the editor cannot show stays custom, verbatim', () => {
    expect(parseCron('*/5 * * * *')).toMatchObject({ repeat: 'custom', custom: '*/5 * * * *' });
    expect(parseCron('0 9 31 * *').repeat).toBe('custom'); // day 31 is not offered
    expect(buildCron({ repeat: 'custom', custom: ' 0 0 1 1 * ' })).toBe('0 0 1 1 *');
  });

  it('numeric weekdays read as names; bad times build nothing', () => {
    expect(parseCron('0 9 * * 0')).toMatchObject({ repeat: 'weekly', dow: 'SUN' });
    expect(buildCron({ repeat: 'daily', time: '25:00' })).toBe('');
    expect(buildCron({ repeat: 'monthly', time: '09:00', dom: 40 })).toBe('0 9 28 * *');
  });

  it('isCron checks five fields', () => {
    expect(isCron('0 9 * * *')).toBe(true);
    expect(isCron('0 9 * *')).toBe(false);
  });

  it('rows: enabled first, soonest first, named after their goal', () => {
    const goals = [{ id: 'g1', title: 'Weekly SEO report', description: 'Check rankings' }];
    const rows = scheduleRows(
      [
        { id: 1, cron: '0 9 * * *', enabled: false },
        { id: 2, cron: '0 9 * * *', enabled: true, next_run: '2026-10-05T09:00:00Z' },
        { id: 3, target_type: 'goal', target_id: 'g1', cron: '0 9 * * MON', timezone: 'Europe/London', enabled: true, next_run: '2026-10-02T09:00:00Z', run_count: 4 },
      ],
      '',
      goals,
    );
    expect(rows.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(rows[0]).toMatchObject({ label: 'Weekly SEO report', goalId: 'g1', description: 'Check rankings', timezone: 'Europe/London', runCount: 4 });
    expect('action' in rows[0]).toBe(false);
  });

  it('survives junk', () => {
    expect(scheduleRows(null)).toEqual([]);
    expect(scheduleRows([{ id: 9 }])[0].label).toBe('Scheduled task');
  });
});

describe('memory', () => {
  it('newest first, normalised from the insights rows, filtered', () => {
    const rows = memoryRows([
      { id: 1, content: 'Prefers short answers', memory_type: 'preference', created_at: '2026-09-01' },
      { id: 2, content: 'Works at AGNT', memory_type: 'fact', updated_at: '2026-09-20' },
      { id: 3, content: '   ' },
      null,
    ]);
    expect(rows.map((r) => [r.id, r.type])).toEqual([
      ['2', 'fact'],
      ['1', 'preference'],
    ]);
    expect(memoryRows([{ id: 1, content: 'Prefers short answers' }], 'short')).toHaveLength(1);
    expect(memoryRows(undefined)).toEqual([]);
  });
});

it('initialOf', () => {
  expect(initialOf('nathan')).toBe('N');
  expect(initialOf('')).toBe('A');
});
