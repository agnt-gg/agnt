/**
 * Canvas bridge — the browser side of the canvas awareness tools.
 *
 * Contracts pinned here:
 *   1. state answers truthfully from localStorage (any tab), enriched with
 *      registry names and chat/custom markers.
 *   2. inspect is scoped to ONE frame's subtree, refuses chat transcripts,
 *      and degrades honestly when the frame isn't rendered.
 *   3. writes go through the SAME useWorkspaces functions the UI uses, so
 *      grid clamping and occupancy placement apply identically to the agent.
 *   4. handleCanvasRequest keeps hidden tabs SILENT for writes — localStorage
 *      is shared, so N executing tabs would apply a write N times.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/workspace', query: {} }),
  useRouter: () => ({ replace: vi.fn(() => Promise.resolve()), push: vi.fn(() => Promise.resolve()) }),
}));

const TEST_WIDGETS = [
  ['workspace-chat', { name: 'Chat', icon: 'fas fa-comments', category: 'home', component: { template: '<div/>' }, defaultSize: { cols: 4, rows: 8 }, minSize: { cols: 3, rows: 4 }, isScreenWidget: true }],
  ['traces', { name: 'Traces', icon: 'fas fa-play-circle', category: 'home', component: { template: '<div/>' }, defaultSize: { cols: 6, rows: 4 }, minSize: { cols: 2, rows: 2 }, isScreenWidget: true }],
  ['cw_custom1', { name: 'Buzz Console', icon: 'fas fa-shapes', category: 'custom', component: { template: '<div/>' }, isCustomWidget: true, customDefinition: { id: 'cw_custom1' }, defaultSize: { cols: 4, rows: 4 }, minSize: { cols: 2, rows: 2 } }],
];

const V2 = (widgets, extra = {}) => JSON.stringify({
  workspaces: [{ id: 'ws_1', name: 'Research', createdAt: 1, widgets }],
  activeId: 'ws_1',
  ...extra,
});

const CHAT = { instanceId: 'w_chat', widgetId: 'workspace-chat', col: 0, row: 0, cols: 4, rows: 8, collapsed: false, visible: true, zIndex: 1 };
const TRACES = { instanceId: 'w_tr', widgetId: 'traces', col: 4, row: 0, cols: 8, rows: 8, collapsed: false, visible: true, zIndex: 2 };

async function fresh() {
  // Drain the debounced save from any prior useWorkspaces instance BEFORE
  // clearing storage — its timer would otherwise repopulate what we seed.
  await new Promise((r) => setTimeout(r, 300));
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '';
  const reg = await import('@/canvas/widgetRegistry.js');
  for (const [id, def] of TEST_WIDGETS) reg.registerWidget(id, def);
  return import('./canvasBridge.js');
}

describe('readCanvasState', () => {
  it('reports never-used truthfully when nothing is stored', async () => {
    const { readCanvasState } = await fresh();
    const res = readCanvasState();
    expect(res.success).toBe(true);
    expect(res.open).toBe(false);
    expect(res.summary).toMatch(/never been used/i);
  });

  it('returns workspaces enriched with registry names, chat and custom markers', async () => {
    const { readCanvasState } = await fresh();
    localStorage.setItem('agnt:workspaces:v2', V2([
      CHAT, TRACES,
      { instanceId: 'w_cw', widgetId: 'cw_custom1', col: 0, row: 0, cols: 4, rows: 4, visible: true, zIndex: 3 },
    ]));

    const res = readCanvasState();
    expect(res.open).toBe(true);
    expect(res.grid).toEqual({ cols: 12, rows: 8 });

    const ws = res.workspaces[0];
    expect(ws).toMatchObject({ id: 'ws_1', name: 'Research', active: true });

    const byId = Object.fromEntries(ws.widgets.map((w) => [w.instanceId, w]));
    expect(byId.w_chat).toMatchObject({ name: 'Chat', chat: true, grid: { col: 0, row: 0, cols: 4, rows: 8 } });
    expect(byId.w_tr).toMatchObject({ name: 'Traces', grid: { col: 4, row: 0, cols: 8, rows: 8 } });
    expect(byId.w_tr.chat).toBeUndefined();
    expect(byId.w_cw).toMatchObject({ name: 'Buzz Console', custom: true });
  });

  it('survives corrupt storage', async () => {
    const { readCanvasState } = await fresh();
    localStorage.setItem('agnt:workspaces:v2', '{not json');
    expect(readCanvasState().open).toBe(false);
  });
});

describe('readCanvasState — workspace ownership', () => {
  it('marks the asking conversation\u2019s workspace, distinctly from the active one', async () => {
    const { readCanvasState } = await fresh();
    localStorage.setItem('agnt:workspaces:v2', JSON.stringify({
      workspaces: [
        { id: 'ws_a', name: 'Games', createdAt: 1, widgets: [] },
        { id: 'ws_b', name: 'Research', createdAt: 2, widgets: [] },
      ],
      activeId: 'ws_a',
    }));

    const res = readCanvasState('ws_b');
    const a = res.workspaces.find((w) => w.id === 'ws_a');
    const b = res.workspaces.find((w) => w.id === 'ws_b');

    expect(a.active).toBe(true);
    expect(a.thisConversation).toBeUndefined();
    expect(b.active).toBe(false);
    expect(b.thisConversation, 'the agent must be able to tell its own workspace apart').toBe(true);
    expect(res.hint).toMatch(/thisConversation/);
  });

  it('says so when the caller has no workspace of its own', async () => {
    const { readCanvasState } = await fresh();
    localStorage.setItem('agnt:workspaces:v2', V2([CHAT]));
    const res = readCanvasState();
    expect(res.workspaces.every((w) => w.thisConversation === undefined)).toBe(true);
    expect(res.hint).toMatch(/not inside a workspace/i);
  });
});

describe('inspectCanvasWidget', () => {
  const mountFrame = (instanceId, { title = 'Traces', body = '' } = {}) => {
    const frame = document.createElement('div');
    frame.className = 'widget-frame';
    frame.setAttribute('data-instance-id', instanceId);
    frame.innerHTML = `<div class="wf-hdr"><span class="wf-title">${title}</span></div><div class="wf-body">${body}</div>`;
    document.body.appendChild(frame);
    return frame;
  };

  it('degrades honestly when the frame is not rendered in this tab', async () => {
    const { inspectCanvasWidget } = await fresh();
    const res = await inspectCanvasWidget('w_missing');
    expect(res.success).toBe(false);
    expect(res.found).toBe(false);
    expect(res.error).toMatch(/visible screen/i);
  });

  it('requires an instanceId', async () => {
    const { inspectCanvasWidget } = await fresh();
    expect((await inspectCanvasWidget()).success).toBe(false);
  });

  it('returns title and visible text, and scopes the element scan to the FRAME subtree', async () => {
    // jsdom has no layout — getBoundingClientRect is all zeros — so
    // domScanner's isVisible() correctly rejects every element here. The
    // scoping contract (scan receives root = this frame, nothing else) is
    // therefore pinned at the call boundary; the DOM-walking behaviour of the
    // scanner itself belongs to real-browser probes.
    const scanSpy = vi.fn(() => [{ text: 'Retry ex_5591', tag: 'button', selector: 'button', bbox: { x: 0, y: 0, w: 10, h: 10 } }]);
    vi.doMock('@/views/_components/utility/domScanner.js', () => ({ scanInteractiveElements: scanSpy }));

    const { inspectCanvasWidget } = await fresh();
    localStorage.setItem('agnt:workspaces:v2', V2([TRACES]));
    const frame = mountFrame('w_tr', { body: '<p>24 traces, 3 failed</p><button>Retry ex_5591</button>' });

    const res = await inspectCanvasWidget('w_tr');
    expect(res).toMatchObject({ success: true, found: true, title: 'Traces' });
    expect(res.visibleText).toContain('24 traces, 3 failed');
    expect(res.elements.map((e) => e.text)).toContain('Retry ex_5591');
    // the scan was scoped to exactly this frame's subtree
    expect(scanSpy).toHaveBeenCalledWith({ root: frame });

    vi.doUnmock('@/views/_components/utility/domScanner.js');
  });

  it('refuses to echo a chat window back into the conversation', async () => {
    const { inspectCanvasWidget } = await fresh();
    localStorage.setItem('agnt:workspaces:v2', V2([CHAT]));
    mountFrame('w_chat', { title: 'Chat', body: '<p>user: secret transcript</p>' });

    const res = await inspectCanvasWidget('w_chat');
    expect(res).toMatchObject({ success: true, found: true, chat: true });
    expect(res.visibleText).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain('secret transcript');
  });

  it('caps runaway text and says so', async () => {
    const { inspectCanvasWidget } = await fresh();
    localStorage.setItem('agnt:workspaces:v2', V2([TRACES]));
    mountFrame('w_tr', { body: `<p>${'x'.repeat(9000)}</p>` });

    const res = await inspectCanvasWidget('w_tr');
    expect(res.visibleText.length).toBeLessThanOrEqual(4000);
    expect(res.truncated).toBe(true);
  });
});

describe('executeCanvasCommand — writes ride the UI mutation path', () => {
  it('open places a known widget and reports its landing geometry', async () => {
    const { executeCanvasCommand } = await fresh();
    const res = await executeCanvasCommand('open', { widgetId: 'traces' });
    expect(res.success).toBe(true);
    expect(res.instanceId).toBeTruthy();
    // occupancy-checked placement: must not land on the auto-added chat (4x8 at 0,0)
    expect(res.placed.col).toBeGreaterThanOrEqual(4);

    const { useWorkspaces } = await import('./useWorkspaces.js');
    expect(useWorkspaces().active.value.widgets.some((w) => w.instanceId === res.instanceId)).toBe(true);
  });

  it('open rejects unknown widget ids with guidance', async () => {
    const { executeCanvasCommand } = await fresh();
    const res = await executeCanvasCommand('open', { widgetId: 'definitely_not_real' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Unknown widget/);
  });

  it('open SELF-HEALS a freshly created custom widget by re-listing definitions', async () => {
    // The exact failure from live use: generate_widget saved cw_… server-side,
    // but this tab's registry only knows its last fetch — so open dead-ended
    // on "Unknown widget" for an id the agent had just created. The bridge
    // must re-list (SET_DEFINITIONS → syncToRegistry) and retry.
    const dispatch = vi.fn(async (action) => {
      if (action === 'widgetDefinitions/fetchDefinitions') {
        const { registerWidget } = await import('@/canvas/widgetRegistry.js');
        registerWidget('cw_fresh1', {
          name: 'Fresh Game', icon: 'fas fa-gamepad', category: 'custom',
          component: { template: '<div/>' }, isCustomWidget: true,
          customDefinition: { id: 'cw_fresh1' },
          defaultSize: { cols: 4, rows: 4 }, minSize: { cols: 2, rows: 2 },
        });
      }
    });
    vi.doMock('@/store/state', () => ({ default: { dispatch } }));

    const { executeCanvasCommand } = await fresh();
    const res = await executeCanvasCommand('open', { widgetId: 'cw_fresh1' });

    expect(dispatch).toHaveBeenCalledWith('widgetDefinitions/fetchDefinitions');
    expect(res.success).toBe(true);
    expect(res.instanceId).toBeTruthy();

    vi.doUnmock('@/store/state');
  });

  it('open does NOT re-list for non-custom unknown ids', async () => {
    const dispatch = vi.fn();
    vi.doMock('@/store/state', () => ({ default: { dispatch } }));
    const { executeCanvasCommand } = await fresh();

    const res = await executeCanvasCommand('open', { widgetId: 'not_a_widget' });
    expect(res.success).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();

    vi.doUnmock('@/store/state');
  });

  it('open honours an explicit position when it fits', async () => {
    const { executeCanvasCommand } = await fresh();
    const res = await executeCanvasCommand('open', { widgetId: 'traces', col: 6, row: 4 });
    expect(res.placed).toMatchObject({ col: 6, row: 4 });
  });

  it('close removes exactly the addressed window; missing ids error', async () => {
    const { executeCanvasCommand } = await fresh();
    const { instanceId } = await executeCanvasCommand('open', { widgetId: 'traces' });

    const gone = await executeCanvasCommand('close', { instanceId: 'w_nope' });
    expect(gone.success).toBe(false);
    expect(gone.error).toMatch(/any workspace/); // truly unknown → says so
    expect((await executeCanvasCommand('close', { instanceId })).success).toBe(true);

    const { useWorkspaces } = await import('./useWorkspaces.js');
    expect(useWorkspaces().active.value.widgets.some((w) => w.instanceId === instanceId)).toBe(false);
  });

  it('names the OWNING workspace when the id lives in a non-active tab', async () => {
    // The live failure: agent read ids, the user switched workspace tabs, and
    // close returned a dead-end "not in the active workspace". The error must
    // say WHERE the window actually is.
    //
    // ORDER MATTERS: useWorkspaces is a module singleton that reads
    // localStorage exactly once at load, and canvasBridge imports it at module
    // top (for STORAGE_KEY). Seeding after fresh() would initialize the
    // singleton from EMPTY storage — the seed must land first.
    await new Promise((r) => setTimeout(r, 300));
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
    localStorage.setItem('agnt:workspaces:v2', JSON.stringify({
      workspaces: [
        { id: 'ws_a', name: 'Games', createdAt: 1, widgets: [] },
        { id: 'ws_b', name: 'Research', createdAt: 2, widgets: [{ instanceId: 'w_elsewhere', widgetId: 'traces', col: 0, row: 0, cols: 6, rows: 4, visible: true, zIndex: 1 }] },
      ],
      activeId: 'ws_a',
    }));
    const reg = await import('@/canvas/widgetRegistry.js');
    for (const [id, def] of TEST_WIDGETS) reg.registerWidget(id, def);
    const { executeCanvasCommand } = await import('./canvasBridge.js');

    const res = await executeCanvasCommand('close', { instanceId: 'w_elsewhere' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('Research');
    // Names BOTH sides so the model can act on it, rather than dead-ending.
    expect(res.error).toContain('Games');
  });

  /* ═══════════ workspace addressing ═══════════
   * Reported: "I asked one chat to place some widgets and it placed them in
   * another workspace." A turn runs for tens of seconds; the user is free to
   * switch tabs while it does. Resolving the target at EXECUTION time means
   * the write lands wherever they happen to be looking. */

  /** Two workspaces, ws_a active — the conversation asking lives in ws_b. */
  const twoWorkspaces = async () => {
    await new Promise((r) => setTimeout(r, 300));
    vi.resetModules();
    localStorage.clear();
    document.body.innerHTML = '';
    localStorage.setItem('agnt:workspaces:v2', JSON.stringify({
      workspaces: [
        { id: 'ws_a', name: 'Games', createdAt: 1, widgets: [] },
        { id: 'ws_b', name: 'Research', createdAt: 2, widgets: [] },
      ],
      activeId: 'ws_a',
    }));
    const reg = await import('@/canvas/widgetRegistry.js');
    for (const [id, def] of TEST_WIDGETS) reg.registerWidget(id, def);
    return import('./canvasBridge.js');
  };

  const stored = () => JSON.parse(localStorage.getItem('agnt:workspaces:v2'));
  const byId = (id) => stored().workspaces.find((w) => w.id === id);

  it('opens into the ASKING conversation\u2019s workspace, not the selected tab', async () => {
    const { executeCanvasCommand } = await twoWorkspaces();

    const res = await executeCanvasCommand('open', { widgetId: 'traces' }, 'ws_b');
    expect(res.success).toBe(true);
    expect(res.workspace).toEqual({ id: 'ws_b', name: 'Research' });

    await new Promise((r) => setTimeout(r, 300)); // let the debounced save land
    expect(byId('ws_b').widgets.map((w) => w.widgetId)).toEqual(['traces']);
    expect(byId('ws_a').widgets, 'the visible workspace must be untouched').toEqual([]);
  });

  it('closes and moves in the asking workspace too', async () => {
    const { executeCanvasCommand } = await twoWorkspaces();
    const { instanceId } = await executeCanvasCommand('open', { widgetId: 'traces' }, 'ws_b');

    const moved = await executeCanvasCommand('move', { instanceId, col: 2, row: 1 }, 'ws_b');
    expect(moved.success).toBe(true);
    expect(moved.geometry).toMatchObject({ col: 2, row: 1 });

    const closed = await executeCanvasCommand('close', { instanceId }, 'ws_b');
    expect(closed.success).toBe(true);

    await new Promise((r) => setTimeout(r, 300));
    expect(byId('ws_b').widgets).toEqual([]);
    expect(byId('ws_a').widgets).toEqual([]);
  });

  it('still targets the active workspace when no workspace is supplied', async () => {
    // Requests from the main chat screen have no workspace of their own; the
    // active one is the only sensible meaning there.
    const { executeCanvasCommand } = await twoWorkspaces();
    const res = await executeCanvasCommand('open', { widgetId: 'traces' });
    expect(res.success).toBe(true);
    expect(res.workspace.id).toBe('ws_a');
  });

  it('REFUSES rather than retargeting when the asking workspace is gone', async () => {
    // Silently falling back to the active workspace would re-create the exact
    // cross-workspace write this addressing exists to prevent.
    const { executeCanvasCommand } = await twoWorkspaces();
    const res = await executeCanvasCommand('open', { widgetId: 'traces' }, 'ws_deleted');
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no longer exists/i);

    await new Promise((r) => setTimeout(r, 300));
    expect(byId('ws_a').widgets, 'must not have fallen back').toEqual([]);
    expect(byId('ws_b').widgets).toEqual([]);
  });

  it('a window in another workspace is refused, naming both workspaces', async () => {
    const { executeCanvasCommand } = await twoWorkspaces();
    const { instanceId } = await executeCanvasCommand('open', { widgetId: 'traces' }, 'ws_a');

    const res = await executeCanvasCommand('close', { instanceId }, 'ws_b');
    expect(res.success).toBe(false);
    expect(res.error).toContain('Games');
    expect(res.error).toContain('Research');
  });

  it('move applies partial geometry and CLAMPS to the grid like a user drag', async () => {
    const { executeCanvasCommand } = await fresh();
    const { instanceId } = await executeCanvasCommand('open', { widgetId: 'traces' });

    const res = await executeCanvasCommand('move', { instanceId, col: 99, rows: 99 });
    expect(res.success).toBe(true);
    expect(res.geometry.col + res.geometry.cols).toBeLessThanOrEqual(12);
    expect(res.geometry.row + res.geometry.rows).toBeLessThanOrEqual(8);

    expect((await executeCanvasCommand('move', { instanceId })).success).toBe(false); // no fields
  });
});

describe('handleCanvasRequest — routing and write safety', () => {
  const setVisibility = (v) =>
    Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });

  it('routes state and unknown actions', async () => {
    const { handleCanvasRequest } = await fresh();
    expect((await handleCanvasRequest('state', {})).success).toBe(true);
    expect((await handleCanvasRequest('detonate', {})).success).toBe(false);
  });

  it('stays SILENT (null) for writes in a hidden tab, answers when visible', async () => {
    const { handleCanvasRequest } = await fresh();
    setVisibility('hidden');
    expect(await handleCanvasRequest('open', { widgetId: 'traces' })).toBeNull();

    setVisibility('visible');
    const res = await handleCanvasRequest('open', { widgetId: 'traces' });
    expect(res.success).toBe(true);
  });

  it('still answers READS from a hidden tab — state is shared localStorage', async () => {
    const { handleCanvasRequest } = await fresh();
    setVisibility('hidden');
    const res = await handleCanvasRequest('state', {});
    expect(res).not.toBeNull();
    expect(res.success).toBe(true);
    setVisibility('visible');
  });
});
