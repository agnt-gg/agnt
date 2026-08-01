// Cross-device workspace sync: the last-write-wins clock, the reconcile rules,
// and the request contract.
//
// THE BUG THESE PIN:
// updatedAt is the ONLY input to last-write-wins, and it was advanced by 3 of
// the 15 functions that persist. The 12 that forgot included the entire widget
// layout — which IS the synced payload. So: rearrange your widgets on device A
// (clock frozen), rename the stale copy on device B (clock advances), let A
// hydrate, and A's layout is silently replaced by B's older one. Single-device
// testing cannot see it, because `w.updatedAt || stamp` fills a missing stamp
// with now() on the way out.
//
// The fix is one stamp at the persistence chokepoint, driven by change
// detection, so a 16th mutator cannot reintroduce the bug by forgetting a
// line. The table below is the guard: every exported function must be
// classified as either "changes synced state" or "does not", and a new one
// that is neither fails the coverage test.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const STORAGE_KEY = 'agnt:workspaces:v2';
const BASE_URL = 'http://localhost:3333/api';

vi.mock('@/tt.config.js', () => ({
  API_CONFIG: { BASE_URL: 'http://localhost:3333/api' },
}));

const WIDGET_DEF = {
  name: 'W',
  icon: 'fas fa-square',
  category: 'home',
  component: { template: '<div/>' },
  defaultSize: { cols: 4, rows: 4 },
  minSize: { cols: 2, rows: 2 },
  isScreenWidget: true,
};

// ---------------------------------------------------------------- fake clock
// Date.now drives updatedAt. Two saves inside the same real millisecond would
// produce an equal stamp and make "did it advance?" unanswerable.
let nowMs = 1_000_000;
const tick = (ms = 1000) => {
  nowMs += ms;
  return nowMs;
};

// ---------------------------------------------------------------- fake server
let serverWorkspaces = [];
let requests = [];

function installFetch() {
  global.fetch = vi.fn(async (url, opts = {}) => {
    requests.push({ url, opts });
    const method = opts.method || 'GET';
    if (method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ workspaces: serverWorkspaces }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
}

/** Boot a pristine copy of the singleton against whatever storage is present. */
async function boot(persisted = null) {
  // The module owns a 250ms debounce. A test ending right after a mutation
  // leaves that timer in flight, and it then fires against the OLD module
  // instance, writing its state back after the next test cleared storage.
  await new Promise((r) => setTimeout(r, 300));
  vi.resetModules();
  localStorage.clear();
  if (persisted) localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  const reg = await import('@/canvas/widgetRegistry.js');
  reg.registerWidget('workspace-chat', WIDGET_DEF);
  reg.registerWidget('traces', WIDGET_DEF);
  reg.registerWidget('goals', WIDGET_DEF);
  const mod = await import('./useWorkspaces.js');
  return mod.useWorkspaces();
}

const widget = (instanceId, widgetId = 'workspace-chat', extra = {}) => ({
  instanceId,
  widgetId,
  chatKey: '',
  col: 0,
  row: 0,
  cols: 4,
  rows: 8,
  collapsed: false,
  visible: true,
  zIndex: 1,
  ...extra,
});

/** A persisted blob as it exists on disk for an already-synced device. */
const persistedWith = (workspaces, syncedIds = workspaces.map((w) => w.id)) => ({
  workspaces,
  activeId: workspaces[0].id,
  autoOpen: true,
  syncedIds,
});

const localWs = (over = {}) => ({
  id: 'ws_1',
  name: 'Trading',
  defaultName: 'Workspace 1',
  widgets: [widget('w_1')],
  createdAt: 500_000,
  updatedAt: 900_000,
  ai: null,
  channelConversations: {},
  ...over,
});

beforeEach(() => {
  nowMs = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
  serverWorkspaces = [];
  requests = [];
  installFetch();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// =============================================================== the contract
describe('useWorkspaces sync — updatedAt is advanced by every mutator', () => {
  // Each entry mutates the ACTIVE workspace's SYNCED shape (name / widgets /
  // ai / channelConversations) and must therefore advance its clock.
  const MUTATORS = {
    renameWorkspace: (api, ws) => api.renameWorkspace(ws.id, 'Renamed'),
    setWorkspaceAi: (api, ws) => api.setWorkspaceAi(ws.id, { provider: 'anthropic', model: 'x' }),
    setChannelConversation: (api, ws) => api.setChannelConversation(`workspace:${ws.id}`, 'conv_1'),
    addWidget: (api) => api.addWidget('traces'),
    removeWidget: (api, ws) => api.removeWidget(ws.widgets[0].instanceId),
    navigateWidget: (api, ws) => api.navigateWidget(ws.widgets[0].instanceId, 'goals'),
    historyGo: (api, ws) => {
      api.navigateWidget(ws.widgets[0].instanceId, 'goals');
      api.saveNow();
      tick();
      api.historyGo(ws.widgets[0].instanceId, -1);
    },
    updateWidgetGeometry: (api, ws) =>
      api.updateWidgetGeometry(ws.widgets[0].instanceId, { col: 2, row: 1 }),
    toggleCollapse: (api, ws) => api.toggleCollapse(ws.widgets[0].instanceId),
    bringToFront: (api, ws) => api.bringToFront(ws.widgets[0].instanceId),
    panelScopeFor: (api, ws) => api.panelScopeFor(ws.widgets[0].instanceId).set('left', 'open'),
    // Order is positional, so moving a tab changes the synced shape of every
    // tab whose index moved — including this one.
    moveWorkspace: (api, ws) => api.moveWorkspace(ws.id, 1),
  };

  // Exported functions that must NOT advance a workspace's clock. setActive
  // and setAutoOpen persist UI preference, not synced workspace state:
  // switching tabs on one device must not win LWW against a real edit on
  // another. closeWorkspace removes a workspace (tracked via deletedIds) and
  // leaves the survivors untouched.
  const NOT_SYNCED_STATE = ['setActive', 'setAutoOpen', 'closeWorkspace'];

  // Reads, plumbing, and the explicitly-tested creator.
  const NOT_A_MUTATOR = [
    'getChannelConversation',
    'resolveWorkspace',
    'hydrateFromServer',
    'save',
    'saveNow',
    'createWorkspace',
  ];

  it.each(Object.keys(MUTATORS))('%s advances updatedAt', async (name) => {
    // Two workspaces so a reorder has somewhere to go. The target is found by
    // ID, not index, because moveWorkspace changes what index 0 refers to.
    const api = await boot(
      persistedWith([
        localWs({ widgets: [widget('w_1'), widget('w_2', 'traces')] }),
        localWs({ id: 'ws_2', name: 'Second' }),
      ]),
    );
    const target = () => api.workspaces.value.find((w) => w.id === 'ws_1');
    const before = target().updatedAt;
    expect(before).toBe(900_000);

    tick();
    MUTATORS[name](api, target());
    api.saveNow();

    expect(target().updatedAt).toBeGreaterThan(before);
  });

  it('classifies EVERY exported function — a new mutator cannot slip through', async () => {
    const api = await boot(persistedWith([localWs()]));
    const exportedFns = Object.entries(api)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k);

    const classified = new Set([
      ...Object.keys(MUTATORS),
      ...NOT_SYNCED_STATE,
      ...NOT_A_MUTATOR,
    ]);
    const unclassified = exportedFns.filter((n) => !classified.has(n));

    expect(unclassified).toEqual([]);
    // Anti-vacuity: the scan must actually be finding the API.
    expect(exportedFns.length).toBeGreaterThan(10);
  });

  it.each(NOT_SYNCED_STATE.filter((n) => n !== 'closeWorkspace'))(
    '%s does NOT advance updatedAt',
    async (name) => {
      const api = await boot(persistedWith([localWs(), localWs({ id: 'ws_2', name: 'Other' })]));
      const before = api.workspaces.value.map((w) => w.updatedAt);

      tick();
      if (name === 'setActive') api.setActive('ws_2');
      if (name === 'setAutoOpen') api.setAutoOpen(false);
      api.saveNow();

      expect(api.workspaces.value.map((w) => w.updatedAt)).toEqual(before);
    },
  );

  it('closeWorkspace leaves the surviving workspace clocks untouched', async () => {
    const api = await boot(persistedWith([localWs(), localWs({ id: 'ws_2', name: 'Other' })]));
    tick();
    api.closeWorkspace('ws_2');
    api.saveNow();

    expect(api.workspaces.value).toHaveLength(1);
    expect(api.workspaces.value[0].updatedAt).toBe(900_000);
  });

  it('a persist with no change does NOT advance the clock', async () => {
    // Proves updatedAt is excluded from the compared shape. If it were
    // included, every save would differ from the last and re-stamp forever.
    const api = await boot(persistedWith([localWs()]));
    tick();
    api.saveNow();
    tick();
    api.saveNow();

    expect(api.workspaces.value[0].updatedAt).toBe(900_000);
  });

  it('createWorkspace stamps the new workspace', async () => {
    const api = await boot(persistedWith([localWs()]));
    tick();
    const ws = api.createWorkspace('Fresh');
    api.saveNow();

    const created = api.workspaces.value.find((w) => w.id === ws.id);
    expect(typeof created.updatedAt).toBe('number');
    expect(created.updatedAt).toBe(nowMs);
  });

  it('booting does not stamp persisted workspaces as newly edited', async () => {
    // The seed. Without it the first save sees every workspace as "changed",
    // stamps them all with now(), and local beats every remote copy forever —
    // sync silently becomes one-way, which is worse than no sync.
    const api = await boot(persistedWith([localWs()]));
    tick(50_000);
    api.saveNow();

    expect(api.workspaces.value[0].updatedAt).toBe(900_000);
  });
});

// ======================================================= last-write-wins core
describe('useWorkspaces sync — last-write-wins', () => {
  it('REGRESSION: a rearrange on this device survives a rename on a stale one', async () => {
    // The exact loss path. Device A rearranges (T=1_001_000). The server still
    // holds B's copy, renamed at T=950_000 with only one widget. A's layout
    // must win, because A's edit is newer.
    const api = await boot(
      persistedWith([
        localWs({ widgets: [widget('w_1'), widget('w_2', 'traces', { rows: 4 })] }),
      ]),
    );

    tick();
    // rows:4 at row:2 fits the 8-row grid, so clampInstance leaves it alone.
    api.updateWidgetGeometry('w_2', { col: 3, row: 2 });
    api.saveNow();

    serverWorkspaces = [
      {
        id: 'ws_1',
        name: 'Renamed On B',
        widgets: [widget('w_1')],
        ai: null,
        channelConversations: {},
        updatedAt: 950_000,
      },
    ];

    await api.hydrateFromServer();

    const ws = api.workspaces.value.find((w) => w.id === 'ws_1');
    expect(ws.widgets).toHaveLength(2);
    expect(ws.widgets.find((w) => w.instanceId === 'w_2')).toMatchObject({ col: 3, row: 2 });
    expect(ws.name).toBe('Trading');
  });

  it('a newer remote copy wins', async () => {
    const api = await boot(persistedWith([localWs()]));
    serverWorkspaces = [
      {
        id: 'ws_1',
        name: 'Newer On B',
        widgets: [widget('w_9', 'traces')],
        ai: { provider: 'openai', model: 'gpt-4o' },
        channelConversations: {},
        updatedAt: 950_000,
      },
    ];

    await api.hydrateFromServer();

    const ws = api.workspaces.value.find((w) => w.id === 'ws_1');
    expect(ws.name).toBe('Newer On B');
    expect(ws.widgets[0].instanceId).toBe('w_9');
    expect(ws.ai).toEqual({ provider: 'openai', model: 'gpt-4o' });
  });

  it('a stale remote copy still contributes conversation ids it alone has', async () => {
    const api = await boot(persistedWith([localWs()]));
    serverWorkspaces = [
      {
        id: 'ws_1',
        name: 'Stale',
        widgets: [],
        ai: null,
        channelConversations: { 'workspace:ws_1:w_7': 'conv_remote' },
        updatedAt: 100_000,
      },
    ];

    await api.hydrateFromServer();

    const ws = api.workspaces.value.find((w) => w.id === 'ws_1');
    expect(ws.name).toBe('Trading');
    expect(ws.channelConversations['workspace:ws_1:w_7']).toBe('conv_remote');
  });

  it('hydrating does not restamp what the server just gave us', async () => {
    const api = await boot(persistedWith([localWs()]));
    serverWorkspaces = [
      {
        id: 'ws_1',
        name: 'Newer On B',
        widgets: [],
        ai: null,
        channelConversations: {},
        updatedAt: 950_000,
      },
    ];

    await api.hydrateFromServer();

    // Still the server's stamp, not now(). Otherwise every hydrate would make
    // this device spuriously newer and push its copy straight back.
    expect(api.workspaces.value.find((w) => w.id === 'ws_1').updatedAt).toBe(950_000);
  });
});

// ====================================================== deletion reconcile
describe('useWorkspaces sync — deletion reconcile', () => {
  it('removes a workspace the server has deleted', async () => {
    const api = await boot(persistedWith([localWs(), localWs({ id: 'ws_2', name: 'Gone' })]));
    serverWorkspaces = [
      { id: 'ws_1', name: 'Trading', widgets: [], ai: null, channelConversations: {}, updatedAt: 100 },
    ];

    await api.hydrateFromServer();

    expect(api.workspaces.value.map((w) => w.id)).toEqual(['ws_1']);
  });

  it('preserves a workspace this device created and never synced', async () => {
    const api = await boot(
      persistedWith(
        [localWs(), localWs({ id: 'ws_new', name: 'Draft' })],
        ['ws_1'], // ws_new is NOT in syncedIds
      ),
    );
    serverWorkspaces = [
      { id: 'ws_1', name: 'Trading', widgets: [], ai: null, channelConversations: {}, updatedAt: 100 },
    ];

    await api.hydrateFromServer();

    expect(api.workspaces.value.map((w) => w.id).sort()).toEqual(['ws_1', 'ws_new']);
  });

  it('REGRESSION: an empty tab the user named "Workspace 2" is NOT deleted', async () => {
    // isStockBlank used to match /^Workspace \d+$/ against the user's own text,
    // so naming a tab "Workspace 2" and leaving it empty meant losing it on the
    // next hydrate. Provenance, not pattern.
    const api = await boot(
      persistedWith(
        [
          localWs(),
          localWs({ id: 'ws_named', name: 'Workspace 2', defaultName: 'Workspace 7', widgets: [] }),
        ],
        ['ws_1'],
      ),
    );
    serverWorkspaces = [
      { id: 'ws_1', name: 'Trading', widgets: [], ai: null, channelConversations: {}, updatedAt: 100 },
    ];

    await api.hydrateFromServer();

    expect(api.workspaces.value.map((w) => w.id)).toContain('ws_named');
  });

  it('drops the untouched boot shell once the server has real tabs', async () => {
    // Nothing persisted => the module mints the boot shell itself.
    const api = await boot(null);
    expect(api.workspaces.value).toHaveLength(1);
    const shellId = api.workspaces.value[0].id;

    serverWorkspaces = [
      { id: 'ws_real', name: 'Trading', widgets: [], ai: null, channelConversations: {}, updatedAt: 100 },
    ];

    await api.hydrateFromServer();

    expect(api.workspaces.value.map((w) => w.id)).toEqual(['ws_real']);
    expect(api.workspaces.value.map((w) => w.id)).not.toContain(shellId);
  });

  it('keeps a boot shell the user renamed', async () => {
    const api = await boot(null);
    const shellId = api.workspaces.value[0].id;
    tick();
    api.renameWorkspace(shellId, 'My Notes');
    api.saveNow();

    serverWorkspaces = [
      { id: 'ws_real', name: 'Trading', widgets: [], ai: null, channelConversations: {}, updatedAt: 100 },
    ];

    await api.hydrateFromServer();

    expect(api.workspaces.value.map((w) => w.id)).toContain(shellId);
  });

  it('keeps a boot shell that already holds a conversation', async () => {
    const api = await boot(null);
    const shellId = api.workspaces.value[0].id;
    tick();
    api.setChannelConversation(`workspace:${shellId}`, 'conv_real');
    api.saveNow();

    serverWorkspaces = [
      { id: 'ws_real', name: 'Trading', widgets: [], ai: null, channelConversations: {}, updatedAt: 100 },
    ];

    await api.hydrateFromServer();

    expect(api.workspaces.value.map((w) => w.id)).toContain(shellId);
  });
});

// ============================================================== tab order
describe('useWorkspaces sync — tab order', () => {
  // Order is a property of the COLLECTION, not of any one workspace, so the
  // per-workspace LWW clock cannot resolve it on its own. It was also the one
  // field the server faithfully stored and returned while the client threw it
  // away, so tab order never crossed devices at all.
  const two = () =>
    persistedWith([localWs(), localWs({ id: 'ws_2', name: 'Second' })]);

  const ids = (api) => api.workspaces.value.map((w) => w.id);

  it('moveWorkspace reorders the tabs', async () => {
    const api = await boot(two());
    expect(ids(api)).toEqual(['ws_1', 'ws_2']);

    tick();
    api.moveWorkspace('ws_1', 1);

    expect(ids(api)).toEqual(['ws_2', 'ws_1']);
  });

  it('stamps every tab whose position changed', async () => {
    const api = await boot(two());
    tick();
    api.moveWorkspace('ws_1', 1);
    api.saveNow();

    // Both moved, so both must travel in the same LWW generation — otherwise
    // the other device applies half a reorder.
    for (const w of api.workspaces.value) expect(w.updatedAt).toBe(nowMs);
  });

  it('moving a tab onto itself changes nothing', async () => {
    const api = await boot(two());
    tick();
    api.moveWorkspace('ws_1', 0);
    api.saveNow();

    expect(ids(api)).toEqual(['ws_1', 'ws_2']);
    expect(api.workspaces.value[0].updatedAt).toBe(900_000);
  });

  it('pushes the new order to the server', async () => {
    const api = await boot(two());
    serverWorkspaces = [
      { id: 'ws_1', name: 'Trading', order: 0, widgets: [], ai: null, channelConversations: {}, updatedAt: 100 },
      { id: 'ws_2', name: 'Second', order: 1, widgets: [], ai: null, channelConversations: {}, updatedAt: 100 },
    ];
    await api.hydrateFromServer();   // unlocks pushing
    requests.length = 0;

    tick();
    api.moveWorkspace('ws_1', 1);
    api.saveNow();
    await new Promise((r) => setTimeout(r, 500));   // push debounce is 400ms

    const put = requests.find((r) => r.opts.method === 'PUT');
    expect(put).toBeTruthy();
    const body = JSON.parse(put.opts.body);
    expect(body.workspaces.map((w) => [w.id, w.order])).toEqual([['ws_2', 0], ['ws_1', 1]]);
  });

  it('applies the server tab order on hydrate', async () => {
    const api = await boot(two());
    serverWorkspaces = [
      { id: 'ws_2', name: 'Second', order: 0, widgets: [], ai: null, channelConversations: {}, updatedAt: 950_000 },
      { id: 'ws_1', name: 'Trading', order: 1, widgets: [], ai: null, channelConversations: {}, updatedAt: 950_000 },
    ];

    await api.hydrateFromServer();

    expect(ids(api)).toEqual(['ws_2', 'ws_1']);
  });

  it('keeps a local reorder that is newer than the server copy', async () => {
    // Reordered on this device while offline. The next hydrate must not
    // silently undo it.
    const api = await boot(two());
    tick(200_000);                   // now 1_200_000
    api.moveWorkspace('ws_1', 1);
    api.saveNow();
    expect(ids(api)).toEqual(['ws_2', 'ws_1']);

    serverWorkspaces = [
      { id: 'ws_1', name: 'Trading', order: 0, widgets: [], ai: null, channelConversations: {}, updatedAt: 950_000 },
      { id: 'ws_2', name: 'Second', order: 1, widgets: [], ai: null, channelConversations: {}, updatedAt: 950_000 },
    ];

    await api.hydrateFromServer();

    expect(ids(api)).toEqual(['ws_2', 'ws_1']);
  });

  it('sorts tabs the server has never seen last, keeping their relative order', async () => {
    const api = await boot(
      persistedWith(
        [localWs({ id: 'ws_new', name: 'Draft' }), localWs(), localWs({ id: 'ws_new2', name: 'Draft 2' })],
        ['ws_1'],
      ),
    );
    serverWorkspaces = [
      { id: 'ws_1', name: 'Trading', order: 0, widgets: [], ai: null, channelConversations: {}, updatedAt: 950_000 },
    ];

    await api.hydrateFromServer();

    // Unknown tabs collide at "no position", so they must fall back to a
    // stable sort rather than jumbling.
    expect(ids(api)).toEqual(['ws_1', 'ws_new', 'ws_new2']);
  });
});

// ======================================================== request contract
describe('useWorkspaces sync — request contract', () => {
  it('calls the configured API base, not a bare relative path', async () => {
    // A relative '/api/workspaces' resolves against the vite dev server (5173),
    // where nothing proxies it, so sync silently no-ops in dev and in any
    // split-origin deployment.
    const api = await boot(persistedWith([localWs()]));
    await api.hydrateFromServer();

    expect(requests.length).toBeGreaterThan(0);
    expect(requests[0].url).toBe(`${BASE_URL}/workspaces`);
  });

  it('sends the bearer token', async () => {
    localStorage.setItem('token', 'jwt-abc');
    const api = await boot(persistedWith([localWs()]));
    localStorage.setItem('token', 'jwt-abc');
    await api.hydrateFromServer();

    expect(requests[0].opts.headers.Authorization).toBe('Bearer jwt-abc');
  });

  it('builds headers AFTER spreading caller options, so auth cannot be dropped', async () => {
    // No caller passes headers today, so this cannot be observed through a
    // request — it is a latent footgun, and behaviour tests would pass either
    // way. Pin the ordering at the source instead: spreading ...opts AFTER
    // headers replaces the whole headers object, dropping Authorization and
    // turning every sync into a silent 401.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const rel = 'views/Terminal/CenterPanel/screens/Workspace/useWorkspaces.js';
    const found = [`src/${rel}`, `frontend/src/${rel}`]
      .map((p) => path.resolve(process.cwd(), p))
      .find((p) => fs.existsSync(p));
    expect(found, `could not locate useWorkspaces.js from ${process.cwd()}`).toBeTruthy();
    const src = fs.readFileSync(found, 'utf8');
    const body = src.slice(src.indexOf('async function apiFetch'), src.indexOf('export { STORAGE_KEY }'));

    expect(body).toContain('...opts,');
    expect(body).toContain('...(opts.headers || {}),');
    // Anti-vacuity: both markers exist, so these indexes are real positions.
    expect(body.indexOf('...opts,')).toBeLessThan(body.indexOf('headers: {'));
  });
});
