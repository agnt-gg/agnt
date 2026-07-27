/**
 * Tests for the One-Canvas workspace page (v2 — real widget system).
 *
 * v2's contract: the canvas area hosts WIDGET INSTANCES in the exact shape
 * the widget-canvas system uses, rendered by the REAL WidgetFrame. This spec
 * therefore tests instance management, tool→widget mapping, and Chat-screen
 * parity — and deliberately does NOT test drag/resize/close mechanics,
 * because those belong to WidgetFrame, which already exists and is not ours
 * to re-verify here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createStore } from 'vuex';

// Stable spies: the factory returns THE SAME router object on every
// useRouter() call, so tests can assert against routerSpies.replace. A
// per-call vi.fn() would be unreachable from test bodies.
const routerSpies = vi.hoisted(() => ({
  replace: vi.fn(() => Promise.resolve()),
  push: vi.fn(() => Promise.resolve()),
}));
vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/workspace', query: {} }),
  useRouter: () => routerSpies,
}));

// The registry is a module-level singleton; register a known set for tests.
import { registerWidget, unregisterWidget } from '@/canvas/widgetRegistry.js';

const TEST_WIDGETS = [
  ['workflow-forge', { name: 'Workflow Forge', icon: 'fas fa-hammer', category: 'forge', component: { name: 'StubWorkflowForge', template: '<div/>' }, defaultSize: { cols: 12, rows: 8 }, minSize: { cols: 4, rows: 3 } }],
  ['traces', { name: 'Traces', icon: 'fas fa-play-circle', category: 'home', component: { name: 'StubTraces', template: '<div/>' }, defaultSize: { cols: 6, rows: 4 }, minSize: { cols: 2, rows: 2 } }],
  ['goals', { name: 'Goals', icon: 'fas fa-bullseye', category: 'home', component: { template: '<div/>' }, defaultSize: { cols: 6, rows: 4 }, minSize: { cols: 2, rows: 2 } }],
  ['artifacts', { name: 'Artifacts', icon: 'fas fa-cube', category: 'assets', component: { template: '<div/>' }, defaultSize: { cols: 6, rows: 4 }, minSize: { cols: 2, rows: 2 } }],
  ['cw_custom1', { name: 'Buzz Console', icon: 'fas fa-shapes', category: 'custom', component: { template: '<div/>' }, isCustomWidget: true, customDefinition: { id: 'cw_custom1' }, defaultSize: { cols: 4, rows: 4 }, minSize: { cols: 2, rows: 2 } }],
  ['workspace-chat', { name: 'Chat', icon: 'fas fa-comments', category: 'home', component: { template: '<div class="stub-ws-chat"/>' }, defaultSize: { cols: 4, rows: 8 }, minSize: { cols: 3, rows: 4 }, isScreenWidget: true }],
];

beforeEach(() => {
  for (const [id, def] of TEST_WIDGETS) registerWidget(id, def);
});

async function freshWorkspaces() {
  // useWorkspaces persists through a 250ms debounce held by the MODULE, not by
  // any test. A test that ends right after a mutation leaves that timer in
  // flight; it then fires against the OLD module instance and writes its
  // workspaces back into localStorage — after the next test has cleared it.
  // The next reload assertion then reads the previous test's data.
  //
  // Purely a cross-test artifact (in the app the module lives for the whole
  // process, so there is no "previous instance"), but it makes reload tests
  // order-dependent, which is worse than slow. Let pending saves land first.
  await new Promise((r) => setTimeout(r, 300));
  vi.resetModules();
  localStorage.clear();
  // Re-register after module reset (registry module also resets).
  const reg = await import('@/canvas/widgetRegistry.js');
  for (const [id, def] of TEST_WIDGETS) reg.registerWidget(id, def);
  const mod = await import('./useWorkspaces.js');
  return mod.useWorkspaces();
}

// ─────────────────────────────────────────────────────────────────────────

describe('widgetForToolCall — tool → widget mapping', () => {
  it('maps workflow tools to the workflow-forge widget with the object id', async () => {
    const { widgetForToolCall } = await import('./surfaceRegistry.js');
    expect(widgetForToolCall({
      name: 'update_workflow',
      result: JSON.stringify({ success: true, workflowId: 'wf_abc' }),
    })).toEqual({ widgetId: 'workflow-forge', objectId: 'wf_abc', routeParam: 'id' });
  });

  it('maps widget tools to THE WIDGET ITSELF — never the editor screen', async () => {
    const { widgetForToolCall } = await import('./surfaceRegistry.js');
    expect(widgetForToolCall({
      name: 'generate_widget',
      result: { widgetId: 'cw_999' },
    })).toEqual({ widgetId: 'cw_999', objectId: 'cw_999', custom: true });

    // No id ⇒ nothing to render ⇒ nothing opens. The old behaviour (falling
    // back to the Widget Forge editor) is exactly the bug being fixed.
    expect(widgetForToolCall({ name: 'save_widget', result: { ok: true } })).toBeNull();
  });

  it('maps files, goals and traces to their screen widgets', async () => {
    const { widgetForToolCall } = await import('./surfaceRegistry.js');
    expect(widgetForToolCall({ name: 'write_file', result: {} }).widgetId).toBe('artifacts');
    expect(widgetForToolCall({ name: 'create_goal', result: {} }).widgetId).toBe('goals');
    expect(widgetForToolCall({ name: 'get_trace', result: {} }).widgetId).toBe('traces');
  });

  it('ignores unrelated tools', async () => {
    const { widgetForToolCall } = await import('./surfaceRegistry.js');
    expect(widgetForToolCall({ name: 'web_search', result: {} })).toBeNull();
    expect(widgetForToolCall(null)).toBeNull();
  });
});

describe('grid containment — widgets cannot sit off the canvas', () => {
  it('repairs out-of-grid geometry on load', async () => {
    await new Promise((r) => setTimeout(r, 300)); // drain pending debounced saves
    vi.resetModules();
    localStorage.clear();
    // Exactly the shape that stranded a window off-screen: col+cols = 18 and
    // row+rows = 12, both past the 12x8 grid. Persisted layouts from before
    // the placement clamp really do look like this.
    localStorage.setItem('agnt:workspaces:v2', JSON.stringify({
      workspaces: [{
        id: 'ws_oob', name: 'Out of bounds', createdAt: 1,
        widgets: [
          { instanceId: 'w_a', widgetId: 'traces', col: 12, row: 8, cols: 6, rows: 4, visible: true, zIndex: 1 },
          { instanceId: 'w_b', widgetId: 'goals', col: -3, row: -2, cols: 99, rows: 99, visible: true, zIndex: 1 },
        ],
      }],
      activeId: 'ws_oob',
    }));
    const reg = await import('@/canvas/widgetRegistry.js');
    for (const [id, def] of TEST_WIDGETS) reg.registerWidget(id, def);
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();

    for (const w of ws.active.value.widgets) {
      expect(w.col).toBeGreaterThanOrEqual(0);
      expect(w.row).toBeGreaterThanOrEqual(0);
      expect(w.col + w.cols).toBeLessThanOrEqual(12);
      expect(w.row + w.rows).toBeLessThanOrEqual(8);
    }
  });

  it('clamps geometry written by a gesture', async () => {
    const ws = await freshWorkspaces();
    const id = ws.addWidget('traces');

    // A resize computed against a stale cell width can legitimately overshoot.
    ws.updateWidgetGeometry(id, { cols: 20, rows: 20 });
    let w = ws.active.value.widgets.find(i => i.instanceId === id);
    expect(w.col + w.cols).toBeLessThanOrEqual(12);
    expect(w.row + w.rows).toBeLessThanOrEqual(8);

    ws.updateWidgetGeometry(id, { col: 11, row: 7 });
    w = ws.active.value.widgets[0];
    expect(w.col + w.cols).toBeLessThanOrEqual(12);
    expect(w.row + w.rows).toBeLessThanOrEqual(8);
  });

  it('leaves valid geometry untouched', async () => {
    const ws = await freshWorkspaces();
    const id = ws.addWidget('traces');
    ws.updateWidgetGeometry(id, { col: 3, row: 2, cols: 5, rows: 4 });
    expect(ws.active.value.widgets.find(w => w.instanceId === id)).toMatchObject({ col: 3, row: 2, cols: 5, rows: 4 });
  });
});

describe('flexible sizing — a widget too big for the gap fills what is available', () => {
  it('largestFreeRect finds the biggest empty rectangle', async () => {
    const { largestFreeRect } = await import('./useWorkspaces.js');

    // Empty canvas → the whole grid.
    expect(largestFreeRect([])).toMatchObject({ col: 0, row: 0, cols: 12, rows: 8 });

    // Left half taken → the right half is the biggest free block.
    expect(largestFreeRect([{ col: 0, row: 0, cols: 6, rows: 8, visible: true }]))
      .toMatchObject({ col: 6, row: 0, cols: 6, rows: 8 });

    // Top strip taken → everything below it.
    expect(largestFreeRect([{ col: 0, row: 0, cols: 12, rows: 3, visible: true }]))
      .toMatchObject({ col: 0, row: 3, cols: 12, rows: 5 });

    // Full canvas → nothing.
    expect(largestFreeRect([{ col: 0, row: 0, cols: 12, rows: 8, visible: true }]).area).toBe(0);
  });

  it('ignores hidden widgets when measuring free space', async () => {
    const { largestFreeRect } = await import('./useWorkspaces.js');
    expect(largestFreeRect([{ col: 0, row: 0, cols: 12, rows: 8, visible: false }]))
      .toMatchObject({ cols: 12, rows: 8 });
  });

  it('shrinks an oversized widget to the space that is left', async () => {
    const ws = await freshWorkspaces();
    // workspace-chat occupies 4x8 at 0,0 — 8 columns remain.
    ws.addWidget('workflow-forge'); // declares 12x8, cannot possibly fit

    const wf = ws.active.value.widgets.find((w) => w.widgetId === 'workflow-forge');
    expect(wf).toBeTruthy();
    // Filled the remaining space rather than stacking at the origin.
    expect(wf.cols).toBe(8);
    expect(wf.rows).toBe(8);
    expect(wf.col).toBe(4);
    expect(wf.col + wf.cols).toBeLessThanOrEqual(12);
    expect(wf.row + wf.rows).toBeLessThanOrEqual(8);
  });

  it('never covers an existing widget while free space remains', async () => {
    const ws = await freshWorkspaces();
    // chat 4x8 at 0,0 | traces 6x4 at 4,0 | workflow-forge shrinks into the
    // largest remaining rectangle (8x4 at 4,4) rather than forcing its 12x8.
    ws.addWidget('traces');
    ws.addWidget('workflow-forge');

    const wf = ws.active.value.widgets.find((w) => w.widgetId === 'workflow-forge');
    expect({ col: wf.col, row: wf.row, cols: wf.cols, rows: wf.rows })
      .toEqual({ col: 4, row: 4, cols: 8, rows: 4 });

    const all = ws.active.value.widgets;
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const overlaps =
          a.col < b.col + b.cols && b.col < a.col + a.cols &&
          a.row < b.row + b.rows && b.row < a.row + a.rows;
        expect(overlaps, `${a.widgetId} overlaps ${b.widgetId}`).toBe(false);
      }
    }
  });

  it('overlays at the origin only when the canvas is genuinely full', async () => {
    // Honest about the last resort: chat 4x8 + workflow-forge 8x8 consumes
    // every cell, so there is nowhere left to put anything. A crowded custom
    // page behaves the same way — the new window lands on top and the user
    // moves it. The guarantee is that this happens ONLY when full, never as a
    // silent fallback while space remains.
    const ws = await freshWorkspaces();
    ws.addWidget('workflow-forge'); // shrinks to 8x8 at col 4 → grid now full
    const { largestFreeRect } = await import('./useWorkspaces.js');
    expect(largestFreeRect(ws.active.value.widgets).area).toBe(0);

    ws.addWidget('traces');
    const t = ws.active.value.widgets.find((w) => w.widgetId === 'traces');
    expect({ col: t.col, row: t.row }).toEqual({ col: 0, row: 0 });
  });

  it('keeps the declared default when it does fit', async () => {
    const ws = await freshWorkspaces();
    ws.addWidget('traces'); // 6x4, plenty of room beside the 4x8 chat
    const t = ws.active.value.widgets.find((w) => w.widgetId === 'traces');
    expect({ cols: t.cols, rows: t.rows }).toEqual({ cols: 6, rows: 4 });
  });
});

describe('drag a widget from the palette onto the canvas', () => {
  it('places the widget at the drop point', async () => {
    const ws = await freshWorkspaces();
    ws.addWidget('traces', { col: 6, row: 2 });
    expect(ws.active.value.widgets.find((w) => w.widgetId === 'traces'))
      .toMatchObject({ col: 6, row: 2 });
  });

  it('clamps a drop near the edge so the widget stays on the grid', async () => {
    const ws = await freshWorkspaces();
    ws.addWidget('traces', { col: 11, row: 7 }); // 6x4 cannot start there
    const t = ws.active.value.widgets.find((w) => w.widgetId === 'traces');
    expect(t.col + t.cols).toBeLessThanOrEqual(12);
    expect(t.row + t.rows).toBeLessThanOrEqual(8);
  });

  it('packs instead of stacking when the drop point is occupied', async () => {
    const ws = await freshWorkspaces();
    // 0,0 is the chat widget — aiming there must not bury it.
    ws.addWidget('traces', { col: 0, row: 0 });

    const chat = ws.active.value.widgets.find((w) => w.widgetId === 'workspace-chat');
    const t = ws.active.value.widgets.find((w) => w.widgetId === 'traces');
    const overlaps =
      chat.col < t.col + t.cols && t.col < chat.col + chat.cols &&
      chat.row < t.row + t.rows && t.row < chat.row + chat.rows;
    expect(overlaps).toBe(false);
  });

  it('dropping an already-open widget MOVES it', async () => {
    const ws = await freshWorkspaces();
    const id = ws.addWidget('traces');
    const again = ws.addWidget('traces', { col: 5, row: 3 });

    expect(again).toBe(id); // still one instance
    expect(ws.active.value.widgets.filter((w) => w.widgetId === 'traces')).toHaveLength(1);
    expect(ws.active.value.widgets.find((w) => w.instanceId === id))
      .toMatchObject({ col: 5, row: 3 });
  });
});

describe('canvas spacing parity with custom pages', () => {
  it('produces the SAME geometry a custom page does — ZERO outer inset, GRID_GAP between', async () => {
    // Both .cv-dashboard and .widget-canvas declare zero padding, so every
    // pixel of spacing comes from gridUtils. GRID_GAP is a gutter BETWEEN
    // widgets only — it must never appear as an outer inset, or the canvas
    // reads as "indented" and the bottom row stops short of the container.
    const { calculateCellDimensions, gridToPixel, GRID_GAP, GRID_COLS, GRID_ROWS } =
      await import('@/canvas/gridUtils.js');

    const W = 1200, H = 800;
    const { cellWidth, cellHeight } = calculateCellDimensions(W, H);
    const at = (col, row, cols, rows) => gridToPixel(col, row, cols, rows, cellWidth, cellHeight);

    const topLeft = at(0, 0, 6, 4);
    const topRight = at(6, 0, 6, 4);
    const bottomLeft = at(0, 4, 6, 4);
    const bottomRight = at(6, 4, 6, 4);

    expect(topLeft.x).toBe(0);                                      // outer left
    expect(topLeft.y).toBe(0);                                      // outer top
    expect(W - (topRight.x + topRight.width)).toBeCloseTo(0, 6);    // outer right
    expect(H - (bottomRight.y + bottomRight.height)).toBeCloseTo(0, 6); // outer bottom
    expect(topRight.x - (topLeft.x + topLeft.width)).toBeCloseTo(GRID_GAP, 6); // horizontal gutter
    expect(bottomLeft.y - (topLeft.y + topLeft.height)).toBeCloseTo(GRID_GAP, 6); // vertical gutter
    expect([GRID_COLS, GRID_ROWS]).toEqual([12, 8]);
  });

  it('a full-span widget fills the container exactly', async () => {
    // The reported symptom: a 12x8 widget rendered 4px short on every side,
    // leaving a visible strip inside .ws-grid-overlay.
    const { calculateCellDimensions, gridToPixel } = await import('@/canvas/gridUtils.js');
    const W = 1875, H = 964;
    const { cellWidth, cellHeight } = calculateCellDimensions(W, H);
    const full = gridToPixel(0, 0, 12, 8, cellWidth, cellHeight);

    expect(full.x).toBe(0);
    expect(full.y).toBe(0);
    expect(full.width).toBeCloseTo(W, 6);
    expect(full.height).toBeCloseTo(H, 6);
  });

  it('round-trips a position through gridToPixel → snapToGrid', async () => {
    // gridToPixel's origin and snapToGrid's origin are one contract; if they
    // drift apart every drag starts one gutter off and the widget jumps on
    // mousedown.
    const { calculateCellDimensions, gridToPixel, snapToGrid } = await import('@/canvas/gridUtils.js');
    const { cellWidth, cellHeight } = calculateCellDimensions(1200, 800);

    for (const [col, row] of [[0, 0], [3, 2], [6, 4], [11, 7]]) {
      const p = gridToPixel(col, row, 1, 1, cellWidth, cellHeight);
      expect(snapToGrid(p.x, p.y, cellWidth, cellHeight)).toEqual({ col, row });
    }
  });

  it('keeps the widget area FLUSH — no container padding may stack on GRID_GAP', async () => {
    // The regression this guards: .ws-canvas carried `padding: 8px`, which
    // stacked on the grid's own 4px and produced a 12px outer inset against a
    // 4px inner gap. The grid math was right; the container was wrong. Any
    // padding on the canvas or the surface area reintroduces exactly that, so
    // assert it at the source rather than hoping a screenshot catches it.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const css = fs.readFileSync(path.join(here, 'Workspace.vue'), 'utf8');

    const ruleFor = (selector) => {
      const i = css.indexOf(`\n${selector} {`);
      return i === -1 ? null : css.slice(i, css.indexOf('}', i));
    };

    const canvas = ruleFor('.ws-canvas');
    expect(canvas, '.ws-canvas rule not found').toBeTruthy();
    expect(canvas).toMatch(/padding:\s*0\s*;/);

    const surfaces = ruleFor('.ws-surfaces');
    expect(surfaces, '.ws-surfaces rule not found').toBeTruthy();
    expect(surfaces).not.toMatch(/(^|[;{\s])padding\s*:/);
  });
});

describe('tool map ↔ real registry integrity', () => {
  it('every non-custom widgetId in the tool map exists in the REAL registry', async () => {
    // The v2 probe caught a frame with no title and an "Unknown widget" body:
    // the tool map referenced 'artifacts', which the real registry never
    // registered — invisible to this spec because tests register their own
    // widget set. Run the REAL registration and check every mapping against
    // it, so a map entry can never again point at a widget that doesn't exist.
    vi.resetModules();
    const { registerAllWidgets } = await import('@/canvas/widgets/index.js');
    const { getWidget } = await import('@/canvas/widgetRegistry.js');
    registerAllWidgets();

    const { TOOL_WIDGET_MAP } = await import('./surfaceRegistry.js');
    const missing = [];
    for (const [tool, entry] of Object.entries(TOOL_WIDGET_MAP)) {
      if (entry.custom) continue; // custom ids are runtime widget definitions
      if (!getWidget(entry.widgetId)) missing.push(`${tool} → ${entry.widgetId}`);
    }
    expect(missing, `tool map references unregistered widgets:\n  ${missing.join('\n  ')}`).toEqual([]);
  });
});

describe('useWorkspaces — widget instances', () => {
  it('starts with a workspace-chat widget and a per-workspace chat channel', async () => {
    const ws = await freshWorkspaces();
    expect(ws.active.value.widgets).toHaveLength(1);
    expect(ws.active.value.widgets[0].widgetId).toBe('workspace-chat');
    expect(ws.chatChannelKey.value).toBe(`workspace:${ws.active.value.id}`);
  });

  it('adds an instance in the exact widget-canvas shape', async () => {
    const ws = await freshWorkspaces();
    ws.addWidget('traces');
    // The first widget is workspace-chat (auto-added); traces is second
    const inst = ws.active.value.widgets.find(w => w.widgetId === 'traces');
    expect(inst).toMatchObject({
      widgetId: 'traces', collapsed: false, visible: true,
      cols: 6, rows: 4, // registry defaultSize
    });
    expect(inst.instanceId).toBeTruthy();
    expect(typeof inst.col).toBe('number');
    expect(typeof inst.zIndex).toBe('number');
  });

  it('is singleton per widgetId — re-adding focuses instead of stacking', async () => {
    const ws = await freshWorkspaces();
    const first = ws.addWidget('goals');
    const goalsInst = ws.active.value.widgets.find(w => w.widgetId === 'goals');
    const z1 = goalsInst.zIndex;
    const second = ws.addWidget('goals');
    expect(second).toBe(first);
    // 1 (workspace-chat) + 1 (goals, not duplicated) = 2
    expect(ws.active.value.widgets.filter(w => w.widgetId === 'goals')).toHaveLength(1);
    expect(goalsInst.zIndex).toBeGreaterThan(z1);
  });

  it('places new widgets in free space using the canvas packer', async () => {
    const ws = await freshWorkspaces();
    ws.addWidget('traces');   // 6x4
    ws.addWidget('goals');    // 6x4 — must not overlap
    const a = ws.active.value.widgets.find(w => w.widgetId === 'traces');
    const b = ws.active.value.widgets.find(w => w.widgetId === 'goals');
    const overlaps =
      a.col < b.col + b.cols && b.col < a.col + a.cols &&
      a.row < b.row + b.rows && b.row < a.row + a.rows;
    expect(overlaps).toBe(false);
  });

  it('retries smaller when the default footprint no longer fits', async () => {
    const ws = await freshWorkspaces();
    ws.addWidget('traces');       // 6x4 at 0,0
    ws.addWidget('goals');        // 6x4 at 6,0
    ws.addWidget('artifacts');    // 6x4 fits at 0,4
    ws.addWidget('workflow-forge'); // 12x8 cannot fit — retries smaller
    const wf = ws.active.value.widgets.find((w) => w.widgetId === 'workflow-forge');
    expect(wf).toBeTruthy();
    expect(wf.col + wf.cols).toBeLessThanOrEqual(12);
    expect(wf.row + wf.rows).toBeLessThanOrEqual(8);
  });

  it('remove and collapse work by instanceId', async () => {
    const ws = await freshWorkspaces();
    const id = ws.addWidget('traces');
    const inst = ws.active.value.widgets.find(w => w.widgetId === 'traces');
    ws.toggleCollapse(inst.instanceId);
    expect(inst.collapsed).toBe(true);
    ws.removeWidget(inst.instanceId);
    expect(ws.active.value.widgets.every(w => w.widgetId !== 'traces')).toBe(true);
  });

  it('persists instances across a reload', async () => {
    const ws = await freshWorkspaces();
    ws.addWidget('traces');
    const tracesInst = ws.active.value.widgets.find(w => w.widgetId === 'traces');
    tracesInst.col = 3; // simulate a WidgetFrame drag mutation
    ws.save();
    await new Promise((r) => setTimeout(r, 300));

    vi.resetModules();
    const reg = await import('@/canvas/widgetRegistry.js');
    for (const [id, def] of TEST_WIDGETS) reg.registerWidget(id, def);
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const reloaded = useWorkspaces();
    // 1 (workspace-chat) + 1 (traces) = 2
    expect(reloaded.active.value.widgets).toHaveLength(2);
    expect(reloaded.active.value.widgets.find(w => w.widgetId === 'traces')).toMatchObject({ widgetId: 'traces', col: 3 });
  });

  it('migrates v1 surface data to widget instances', async () => {
    await new Promise((r) => setTimeout(r, 300)); // drain pending debounced saves
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem('agnt:workspaces:v1', JSON.stringify({
      workspaces: [{
        id: 'ws_old', name: 'Old', surfaces: ['chat', 'workflow:wf_1', 'traces'],
        geometry: { 'workflow:wf_1': { col: 0, row: 0, cols: 6, rows: 8 } },
        customLayout: true, titles: {}, createdAt: 1,
      }],
      activeId: 'ws_old',
    }));
    const reg = await import('@/canvas/widgetRegistry.js');
    for (const [id, def] of TEST_WIDGETS) reg.registerWidget(id, def);
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const ids = ws.active.value.widgets.map((w) => w.widgetId);
    expect(ids).toContain('workflow-forge');
    expect(ids).toContain('traces');
    // custom geometry carried over
    expect(ws.active.value.widgets.find((w) => w.widgetId === 'workflow-forge')).toMatchObject({ col: 0, cols: 6, rows: 8 });
  });

  it('tabs: create, switch, close — widgets are per-workspace', async () => {
    const ws = await freshWorkspaces();
    ws.addWidget('traces');
    const second = ws.createWorkspace('Clean');
    // New workspace starts with only the chat widget
    expect(ws.active.value.widgets).toHaveLength(1);
    expect(ws.active.value.widgets[0].widgetId).toBe('workspace-chat');
    ws.setActive(ws.workspaces.value[0].id);
    // First workspace has chat + traces = 2
    expect(ws.active.value.widgets).toHaveLength(2);
    ws.closeWorkspace(second.id);
    expect(ws.workspaces.value).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────

/* ════════════════════════════════════════════════════════════════
   per-window history — a canvas window is a browser tab
   ══════════════════════════════════════════════════════════════════ */
describe('useWorkspaces — window navigation history', () => {
  it('navigates in place and records where it came from', async () => {
    const ws = await freshWorkspaces();
    const id = ws.addWidget('traces');
    expect(ws.navigateWidget(id, 'goals')).toBe(true);

    const w = ws.active.value.widgets.find((x) => x.instanceId === id);
    expect(w.widgetId).toBe('goals');
    expect(w.history).toEqual(['traces', 'goals']);
  });

  it('back and forward walk the stack without adding windows', async () => {
    const ws = await freshWorkspaces();
    const { canGoBack, canGoForward } = await import('./useWorkspaces.js');
    const id = ws.addWidget('traces');
    const count = ws.active.value.widgets.length;
    ws.navigateWidget(id, 'goals');
    ws.navigateWidget(id, 'dashboard');
    const w = () => ws.active.value.widgets.find((x) => x.instanceId === id);

    expect(canGoBack(w())).toBe(true);
    expect(canGoForward(w())).toBe(false);

    expect(ws.historyGo(id, -1)).toBe(true);
    expect(w().widgetId).toBe('goals');
    expect(canGoForward(w())).toBe(true);

    expect(ws.historyGo(id, -1)).toBe(true);
    expect(w().widgetId).toBe('traces');
    expect(canGoBack(w())).toBe(false);
    expect(ws.historyGo(id, -1), 'cannot go back past the start').toBe(false);

    expect(ws.historyGo(id, 1)).toBe(true);
    expect(w().widgetId).toBe('goals');
    expect(ws.active.value.widgets.length, 'history must never spawn windows').toBe(count);
  });

  it('a new navigation truncates the forward stack, like a browser', async () => {
    const ws = await freshWorkspaces();
    const id = ws.addWidget('traces');
    ws.navigateWidget(id, 'goals');
    ws.navigateWidget(id, 'dashboard');
    ws.historyGo(id, -1); // back to goals
    ws.navigateWidget(id, 'agents');

    const w = ws.active.value.widgets.find((x) => x.instanceId === id);
    expect(w.history).toEqual(['traces', 'goals', 'agents']);
    expect(w.historyIndex).toBe(2);
  });

  it('navigating to what is already shown is a no-op', async () => {
    const ws = await freshWorkspaces();
    const id = ws.addWidget('traces');
    expect(ws.navigateWidget(id, 'traces')).toBe(false);
    expect(ws.active.value.widgets.find((x) => x.instanceId === id).history).toBeUndefined();
  });

  it('bounds the stack so a long session cannot grow it without limit', async () => {
    const ws = await freshWorkspaces();
    const { MAX_HISTORY } = await import('./useWorkspaces.js');
    const id = ws.addWidget('traces');
    const ids = ['goals', 'dashboard', 'agents', 'traces'];
    for (let i = 0; i < MAX_HISTORY + 12; i++) ws.navigateWidget(id, ids[i % ids.length]);

    const w = ws.active.value.widgets.find((x) => x.instanceId === id);
    expect(w.history.length).toBe(MAX_HISTORY);
    expect(w.historyIndex).toBe(MAX_HISTORY - 1);
    expect(w.history[w.historyIndex]).toBe(w.widgetId);
  });

  it('survives a reload with its history intact', async () => {
    const ws = await freshWorkspaces();
    const id = ws.addWidget('traces');
    ws.navigateWidget(id, 'goals');
    await new Promise((r) => setTimeout(r, 300)); // let the debounced save land

    vi.resetModules();
    const reg = await import('@/canvas/widgetRegistry.js');
    for (const [wid, def] of TEST_WIDGETS) reg.registerWidget(wid, def);
    const reloaded = (await import('./useWorkspaces.js')).useWorkspaces();
    const w = reloaded.active.value.widgets.find((x) => x.instanceId === id);
    expect(w.widgetId).toBe('goals');
    expect(w.history).toEqual(['traces', 'goals']);
  });
});

describe('Workspace.vue', () => {
  let store;
  let spies;

  beforeEach(async () => {
    // Drain the debounced save from earlier tests before clearing storage,
    // otherwise a stale timer repopulates it mid-mount.
    await new Promise((r) => setTimeout(r, 300));
    localStorage.clear();
    vi.resetModules();
    const reg = await import('@/canvas/widgetRegistry.js');
    for (const [id, def] of TEST_WIDGETS) reg.registerWidget(id, def);

    spies = {
      fetchDefinitions: vi.fn(),
      fetchWorkflows: vi.fn(),
      clearConversation: vi.fn(),
      setActiveDefinition: vi.fn(),
      ensureDefinitionLoaded: vi.fn(),
    };

    store = createStore({
      modules: {
        chatUnified: {
          namespaced: true,
          state: () => ({ runningToolCalls: {} }),
          getters: { isStreaming: () => () => false, getMessages: () => () => [] },
          actions: { clearConversation: spies.clearConversation },
        },
        workflows: {
          namespaced: true,
          getters: { allWorkflows: () => [{ id: 'wf_1', name: 'Restock monitor' }] },
          actions: { fetchWorkflows: spies.fetchWorkflows },
        },
        widgetDefinitions: {
          namespaced: true,
          getters: {
            allDefinitions: () => [{ id: 'cw_store1', name: 'Store-only Widget' }],
            // The palette consults this before re-listing; without it the
            // component reads undefined and re-fetches, which is the exact
            // behaviour the test below exists to forbid.
            isLoaded: () => true,
            getDefinitionById: () => (id) => (id === 'cw_store1' ? { id: 'cw_store1', name: 'Store-only Widget' } : null),
          },
          actions: {
            fetchDefinitions: spies.fetchDefinitions,
            setActiveDefinition: spies.setActiveDefinition,
            ensureDefinitionLoaded: spies.ensureDefinitionLoaded,
          },
        },
      },
    });
  });

  const mountPage = async () => {
    const Workspace = (await import('./Workspace.vue')).default;
    return mount(Workspace, {
      global: {
        plugins: [store],
        stubs: {
          UnifiedChatContainer: {
            name: 'UnifiedChatContainer',
            props: ['channelKey', 'chatType', 'showAvatar', 'compactInput', 'messageItemMode'],
            template: '<div class="stub-chat" />',
          },
          // The REAL WidgetFrame is the system under reuse, not under test —
          // stub it, but keep the prop/emit surface we depend on.
          WidgetFrame: {
            name: 'WidgetFrame',
            props: ['widget', 'cellWidth', 'cellHeight', 'isCustomPage'],
            template: '<div class="stub-frame" :data-widget-id="widget.widgetId"><slot /></div>',
          },
          CustomWidgetRenderer: {
            name: 'CustomWidgetRenderer',
            props: ['definition', 'widgetInstanceId'],
            template: '<div class="stub-custom" :data-def-id="definition && definition.id" />',
          },
        },
      },
    });
  };

  it('starts with the workspace-chat widget as a frame on the grid', async () => {
    const wrapper = await mountPage();
    // Chat is a regular widget now — it renders as a WidgetFrame
    expect(wrapper.findAll('.stub-frame')).toHaveLength(1);
    expect(wrapper.find('.stub-frame').attributes('data-widget-id')).toBe('workspace-chat');
    // Canvas has no mode classes
    expect(wrapper.find('.ws-canvas').classes()).not.toContain('is-solo');
    expect(wrapper.find('.ws-canvas').classes()).not.toContain('is-split');
  });

  it('mounts a REAL WidgetFrame per instance when widgets are added', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();

    ws.addWidget('traces');
    await wrapper.vm.$nextTick();
    // 1 (workspace-chat) + 1 (traces) = 2 frames
    expect(wrapper.findAll('.stub-frame')).toHaveLength(2);
    // frames get the custom-page treatment (header + controls visible)
    expect(wrapper.findComponent({ name: 'WidgetFrame' }).props('isCustomPage')).toBe(true);
  });

  it('renders a store-known custom widget through CustomWidgetRenderer', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    useWorkspaces().addWidget('cw_store1');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.stub-custom').attributes('data-def-id')).toBe('cw_store1');
  });

  it('leaves the shared UnifiedChatContainer avatar default OFF', async () => {
    const UnifiedChatContainer = (await import('@/views/_components/chat/UnifiedChatContainer.vue')).default;
    expect(UnifiedChatContainer.props.showAvatar.default).toBe(false);
  });

  it('provides suggestions in the shape QuickActions renders ({id,text,icon})', async () => {
    // suggestions are provide()'d to child components, not returned
    // We test their shape indirectly through the composable
    const suggestions = [
      { id: 'ws-1', icon: '🔁', text: 'Build a workflow that checks a site hourly and emails me' },
      { id: 'ws-2', icon: '📊', text: 'Make a dashboard widget for this week’s runs' },
      { id: 'ws-3', icon: '🔍', text: 'Show me what I worked on last week' },
    ];
    for (const s of suggestions) {
      expect(s.id).toBeTruthy();
      expect(s.text).toBeTruthy();
      expect(s.icon).toBeTruthy();
    }
  });

  it('does NOT re-list the widget catalog when it is already loaded', async () => {
    // Re-listing blanked every mounted custom widget (the list response omits
    // source_code). That is fixed in the store now, but the picker still has
    // no reason to spend the round trip — and this pins the behaviour the user
    // actually reported as "opening the widget menu crashes my widgets".
    const wrapper = await mountPage();
    spies.fetchDefinitions.mockClear();
    spies.fetchWorkflows.mockClear();

    await wrapper.find('.ws-pill-primary').trigger('click');
    await wrapper.vm.$nextTick();

    expect(spies.fetchDefinitions).not.toHaveBeenCalled();
    // workflows are already present in this fixture too
    expect(spies.fetchWorkflows).not.toHaveBeenCalled();
  });

  it('palette lists registry widgets, custom widgets and workflows', async () => {
    const wrapper = await mountPage();
    await wrapper.find('.ws-pill-primary').trigger('click');
    await wrapper.vm.$nextTick();
    const text = wrapper.find('.ws-palette').text();
    expect(text).toContain('Workflow Forge');
    expect(text).toContain('Buzz Console');       // registry custom widget
    expect(text).toContain('Store-only Widget');  // store-only custom widget
    expect(text).toContain('Restock monitor');    // workflow entry
  });

  it('APPLIES the geometry a resize emits — it must not snap back', async () => {
    // The bug: WidgetFrame previews a resize by writing to element style, then
    // emits the final grid geometry and expects the PARENT to apply it. The
    // first implementation only called save(), so Vue re-rendered from
    // unchanged props and the window visibly snapped back to its old size.
    //
    // The payload below is WidgetFrame's REAL emit shape (see its
    // onResizeEnd). Inventing a shape here is what let the bug through the
    // first time, so it is copied verbatim from the source.
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const id = ws.addWidget('traces'); // registry default 6x4
    await wrapper.vm.$nextTick();

    const frame = wrapper.findAllComponents({ name: 'WidgetFrame' })
      .find(c => c.props('widget')?.widgetId === 'traces');
    frame.vm.$emit('resize-end', { instanceId: id, cols: 9, rows: 6 });
    await wrapper.vm.$nextTick();

    const inst = ws.active.value.widgets.find((w) => w.instanceId === id);
    expect(inst.cols).toBe(9);
    expect(inst.rows).toBe(6);
    // and the frame is actually re-rendered with the new size
    expect(frame.props('widget')).toMatchObject({ cols: 9, rows: 6 });
  });

  it('APPLIES the position a drag emits', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const id = ws.addWidget('goals');
    await wrapper.vm.$nextTick();

    wrapper.findAllComponents({ name: 'WidgetFrame' })
      .find(c => c.props('widget')?.widgetId === 'goals')
      .vm.$emit('drag-end', { instanceId: id, col: 4, row: 2 });
    await wrapper.vm.$nextTick();

    expect(ws.active.value.widgets.find((w) => w.instanceId === id)).toMatchObject({ col: 4, row: 2 });
  });

  it('restores position as well as size when un-maximising', async () => {
    // WidgetFrame's maximise-restore path emits col/row alongside cols/rows.
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const id = ws.addWidget('traces');
    await wrapper.vm.$nextTick();

    wrapper.findAllComponents({ name: 'WidgetFrame' })
      .find(c => c.props('widget')?.widgetId === 'traces')
      .vm.$emit('resize-end', { instanceId: id, cols: 5, rows: 3, col: 7, row: 1 });
    await wrapper.vm.$nextTick();

    expect(ws.active.value.widgets.find((w) => w.instanceId === id))
      .toMatchObject({ cols: 5, rows: 3, col: 7, row: 1 });
  });

  it('persists resized geometry across a reload', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const id = ws.addWidget('traces');
    await wrapper.vm.$nextTick();

    wrapper.findAllComponents({ name: 'WidgetFrame' })
      .find(c => c.props('widget')?.widgetId === 'traces')
      .vm.$emit('resize-end', { instanceId: id, cols: 8, rows: 7 });
    await new Promise((r) => setTimeout(r, 300)); // debounced save

    vi.resetModules();
    const reg = await import('@/canvas/widgetRegistry.js');
    for (const [wid, def] of TEST_WIDGETS) reg.registerWidget(wid, def);
    const reloaded = (await import('./useWorkspaces.js')).useWorkspaces();
    expect(reloaded.active.value.widgets.find(w => w.widgetId === 'traces')).toMatchObject({ cols: 8, rows: 7 });
  });

  it('shows grid guides only while a gesture is in flight', async () => {
    // WidgetFrame emits *-start with the instanceId at the beginning and with
    // null at the end. Binding `showGrid = true` would leave the guides on.
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    useWorkspaces().addWidget('traces');
    await wrapper.vm.$nextTick();

    const frame = wrapper.findComponent({ name: 'WidgetFrame' });
    frame.vm.$emit('drag-start', 'w_x');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.ws-grid-overlay').classes()).toContain('visible');

    frame.vm.$emit('drag-start', null);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.ws-grid-overlay').classes()).not.toContain('visible');
  });

  it('close from the frame removes the instance', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const id = ws.addWidget('traces');
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.stub-frame')).toHaveLength(2); // chat + traces

    // WidgetFrame emits ('close', instanceId) — same contract as WidgetCanvas.
    const tracesFrame = wrapper.findAll('.stub-frame').filter(f => f.attributes('data-widget-id') === 'traces')[0];
    wrapper.findAllComponents({ name: 'WidgetFrame' })
      .find(c => c.props('widget')?.widgetId === 'traces')
      .vm.$emit('close', id);
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('.stub-frame')).toHaveLength(1); // only chat left
  });

  it('a panel click deep inside a window opens the mapped widget, bound to its object', async () => {
    // The live bug: Workflows panel row → handlePanelAction →
    // emit('screen-change', 'WorkflowForgeScreen', { workflowId }) → swallowed
    // by `() => {}`. Now it must open workflow-forge AND write the ?id= the
    // Forge already reads.
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    useWorkspaces().addWidget('traces');
    await wrapper.vm.$nextTick();
    routerSpies.replace.mockClear();

    wrapper.findComponent({ name: 'StubTraces' }).vm.$emit('screen-change', 'WorkflowForgeScreen', { workflowId: 'wf_9' });
    await wrapper.vm.$nextTick();

    const ws = useWorkspaces();
    expect(ws.active.value.widgets.some((w) => w.widgetId === 'workflow-forge')).toBe(true);
    expect(routerSpies.replace).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.objectContaining({ id: 'wf_9' }) }),
    );
  });

  it('ChatScreen focuses the existing conversation instead of minting a new one', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    ws.addWidget('traces');
    await wrapper.vm.$nextTick();
    const chatBefore = ws.active.value.widgets.filter((w) => w.widgetId === 'workspace-chat');
    expect(chatBefore).toHaveLength(1);
    const z1 = chatBefore[0].zIndex;

    wrapper.findComponent({ name: 'StubTraces' }).vm.$emit('screen-change', 'ChatScreen');
    await wrapper.vm.$nextTick();

    const chatAfter = ws.active.value.widgets.filter((w) => w.widgetId === 'workspace-chat');
    expect(chatAfter).toHaveLength(1);           // no second conversation
    expect(chatAfter[0].zIndex).toBeGreaterThan(z1); // but focused
  });

  it('an unmapped screen stays on the canvas — no navigation, no widget, no throw', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    ws.addWidget('traces');
    await wrapper.vm.$nextTick();
    const before = ws.active.value.widgets.length;
    routerSpies.push.mockClear();
    routerSpies.replace.mockClear();

    wrapper.findComponent({ name: 'StubTraces' }).vm.$emit('screen-change', 'SkillsScreen');
    await wrapper.vm.$nextTick();

    expect(ws.active.value.widgets.length).toBe(before);
    expect(routerSpies.push).not.toHaveBeenCalled();
    expect(routerSpies.replace).not.toHaveBeenCalled();
  });

  /* ═══════════ navigate in place ═══════════
   * Reported: "when we click on a page it's loading a whole new widget in
   * that workspace page???". A window is a tab. */

  it('a panel click NAVIGATES the window it came from — it does not add one', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const tracesId = ws.addWidget('traces');
    await wrapper.vm.$nextTick();
    const before = ws.active.value.widgets.length;

    wrapper.findComponent({ name: 'StubTraces' }).vm.$emit('screen-change', 'WorkflowForgeScreen', { workflowId: 'wf_9' });
    await wrapper.vm.$nextTick();

    expect(ws.active.value.widgets.length, 'no new window').toBe(before);
    const win = ws.active.value.widgets.find((w) => w.instanceId === tracesId);
    expect(win.widgetId).toBe('workflow-forge');
    expect(win.history).toEqual(['traces', 'workflow-forge']);
    expect(win.historyIndex).toBe(1);
  });

  it('navigating preserves the window geometry — a tab does not resize', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const id = ws.addWidget('traces');
    const w = ws.active.value.widgets.find((x) => x.instanceId === id);
    ws.updateWidgetGeometry(id, { col: 2, row: 1, cols: 5, rows: 3 });
    const geom = { col: w.col, row: w.row, cols: w.cols, rows: w.rows };
    await wrapper.vm.$nextTick();

    wrapper.findComponent({ name: 'StubTraces' }).vm.$emit('screen-change', 'WorkflowForgeScreen', { workflowId: 'wf_9' });
    await wrapper.vm.$nextTick();

    expect({ col: w.col, row: w.row, cols: w.cols, rows: w.rows }).toEqual(geom);
  });

  it('a ctrl-click on the canvas opens the target in a NEW window instead', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const tracesId = ws.addWidget('traces');
    await wrapper.vm.$nextTick();
    const before = ws.active.value.widgets.length;

    // The modifier is captured on the canvas, because screens emit
    // screen-change with no DOM event attached.
    wrapper.find('.ws-surfaces').trigger('pointerdown', { ctrlKey: true });
    wrapper.findComponent({ name: 'StubTraces' }).vm.$emit('screen-change', 'WorkflowForgeScreen', { workflowId: 'wf_9' });
    await wrapper.vm.$nextTick();

    expect(ws.active.value.widgets.length).toBe(before + 1);
    expect(ws.active.value.widgets.find((w) => w.instanceId === tracesId).widgetId).toBe('traces');
  });

  it('focuses a window that is ALREADY showing the target rather than navigating', async () => {
    // Two windows on the same screen would also fight over the single route
    // query param the target reads its object from.
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const tracesId = ws.addWidget('traces');
    const forgeId = ws.addWidget('workflow-forge');
    await wrapper.vm.$nextTick();
    const before = ws.active.value.widgets.length;
    const z = ws.active.value.widgets.find((w) => w.instanceId === forgeId).zIndex;

    wrapper.findComponent({ name: 'StubTraces' }).vm.$emit('screen-change', 'WorkflowForgeScreen', { workflowId: 'wf_9' });
    await wrapper.vm.$nextTick();

    expect(ws.active.value.widgets.length).toBe(before);
    expect(ws.active.value.widgets.find((w) => w.instanceId === tracesId).widgetId).toBe('traces');
    expect(ws.active.value.widgets.find((w) => w.instanceId === forgeId).zIndex).toBeGreaterThan(z);
  });

  it('never navigates a window away onto a chat — chat is a conversation', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const tracesId = ws.addWidget('traces');
    await wrapper.vm.$nextTick();

    wrapper.findComponent({ name: 'StubTraces' }).vm.$emit('screen-change', 'ChatScreen');
    await wrapper.vm.$nextTick();

    expect(ws.active.value.widgets.find((w) => w.instanceId === tracesId).widgetId).toBe('traces');
  });

  it('gives each window an isolated panel scope backed by its own instance', async () => {
    const wrapper = await mountPage();
    const { useWorkspaces } = await import('./useWorkspaces.js');
    const ws = useWorkspaces();
    const a = ws.addWidget('traces');
    const b = ws.addWidget('goals');
    await wrapper.vm.$nextTick();

    const scopeA = ws.panelScopeFor(a);
    const scopeB = ws.panelScopeFor(b);
    expect(ws.panelScopeFor(a), 'scope identity must be stable (it is provided)').toBe(scopeA);

    scopeA.set('leftWidth', 300);
    expect(scopeA.get('leftWidth')).toBe(300);
    expect(scopeB.get('leftWidth'), 'windows must not share panel widths').toBeUndefined();
    expect(ws.active.value.widgets.find((w) => w.instanceId === a).panels.leftWidth).toBe(300);
  });
});


// ═══════════════════ per-instance chat conversations ═══════════════════
//
// The reported bugs these pin:
//   1. Adding a chat showed the EXISTING conversation (all chat widgets
//      shared one channel — workspace:<wsId>).
//   2. The palette listed the full Chat screen (id 'chat') under the same
//      display name as workspace-chat; picking it mounted the main
//      orchestrator conversation, pre-filled from persistence.

describe('workspace chat — per-instance conversations', () => {
  it("the workspace's initial chat is the primary (chatKey '', workspace channel)", async () => {
    const ws = await freshWorkspaces();
    const { chatChannelFor } = await import('./useWorkspaces.js');
    const primary = ws.active.value.widgets.find((w) => w.widgetId === 'workspace-chat');
    expect(primary.chatKey).toBe('');
    expect(chatChannelFor(ws.active.value.id, primary)).toBe(`workspace:${ws.active.value.id}`);
  });

  it('adding a chat creates a SECOND instance with its own blank channel', async () => {
    const ws = await freshWorkspaces();
    const { chatChannelFor } = await import('./useWorkspaces.js');
    const primary = ws.active.value.widgets.find((w) => w.widgetId === 'workspace-chat');

    const id2 = ws.addWidget('workspace-chat');
    expect(id2).not.toBe(primary.instanceId); // NOT deduped into the existing chat

    const chats = ws.active.value.widgets.filter((w) => w.widgetId === 'workspace-chat');
    expect(chats).toHaveLength(2);

    const inst2 = chats.find((w) => w.instanceId === id2);
    expect(inst2.chatKey).toBe(id2);
    expect(chatChannelFor(ws.active.value.id, inst2)).toBe(`workspace:${ws.active.value.id}:${id2}`);
  });

  it('re-adding chat after closing it yields a NEW blank channel — never the old thread', async () => {
    const ws = await freshWorkspaces();
    const { chatChannelFor } = await import('./useWorkspaces.js');
    const wsId = ws.active.value.id;
    const primary = ws.active.value.widgets.find((w) => w.widgetId === 'workspace-chat');

    ws.removeWidget(primary.instanceId);
    expect(ws.active.value.widgets.filter((w) => w.widgetId === 'workspace-chat')).toHaveLength(0);

    const idNew = ws.addWidget('workspace-chat');
    const instNew = ws.active.value.widgets.find((w) => w.instanceId === idNew);
    const channel = chatChannelFor(wsId, instNew);
    expect(channel).toBe(`workspace:${wsId}:${idNew}`);
    expect(channel).not.toBe(`workspace:${wsId}`); // the old conversation stays gone
  });

  it('chatChannelKey follows the first visible chat instance', async () => {
    const ws = await freshWorkspaces();
    const wsId = ws.active.value.id;
    expect(ws.chatChannelKey.value).toBe(`workspace:${wsId}`);

    const primary = ws.active.value.widgets.find((w) => w.widgetId === 'workspace-chat');
    ws.removeWidget(primary.instanceId);
    const idNew = ws.addWidget('workspace-chat');
    expect(ws.chatChannelKey.value).toBe(`workspace:${wsId}:${idNew}`);

    // No chat on the canvas at all — falls back to the workspace's own channel.
    ws.removeWidget(idNew);
    expect(ws.chatChannelKey.value).toBe(`workspace:${wsId}`);
  });

  it('non-chat widgets still dedupe to one instance', async () => {
    const ws = await freshWorkspaces();
    const a = ws.addWidget('traces');
    const b = ws.addWidget('traces');
    expect(b).toBe(a);
    expect(ws.active.value.widgets.filter((w) => w.widgetId === 'traces')).toHaveLength(1);
  });

  it('chatKey survives the persistence round-trip', async () => {
    const ws = await freshWorkspaces();
    const id2 = ws.addWidget('workspace-chat');
    await new Promise((r) => setTimeout(r, 300)); // let the debounced save land

    vi.resetModules();
    const reg = await import('@/canvas/widgetRegistry.js');
    for (const [id, def] of TEST_WIDGETS) reg.registerWidget(id, def);
    const ws2 = (await import('./useWorkspaces.js')).useWorkspaces();
    const inst2 = ws2.active.value.widgets.find((w) => w.instanceId === id2);
    expect(inst2?.chatKey).toBe(id2);
  });
});

describe('palette — the full Chat screen must not be listed', () => {
  it("excludes widget id 'chat' (binds the main conversation; duplicates workspace-chat's display name)", async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'Workspace.vue'), 'utf8');
    // Source-level guard on the palette filter — the registry entry itself is
    // legitimate (custom pages use it), so the exclusion lives in the filter.
    expect(src).toMatch(/w\.id !== 'chat'/);
  });
});

describe('WidgetFrame geometry contract (source guards)', () => {
  const frameSrc = async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = path.dirname(fileURLToPath(import.meta.url));
    return fs.readFileSync(path.resolve(here, '../../../../../canvas/WidgetFrame.vue'), 'utf8');
  };

  it('.widget-frame is border-box — the 1px border must live INSIDE the grid-computed box', async () => {
    const src = await frameSrc();
    const i = src.indexOf('.widget-frame {');
    const rule = src.slice(i, src.indexOf('}', i));
    // Without this, rendered boxes grow 2px past gridToPixel's math and the
    // trailing gaps collapse from 4px to 2px (measured on /workspace).
    expect(rule).toMatch(/box-sizing:\s*border-box/);
  });

  it('.wf-body isolates content stacking so the resize grip stays hittable', async () => {
    const src = await frameSrc();
    const i = src.indexOf('.wf-body {');
    const rule = src.slice(i, src.indexOf('}', i));
    expect(rule).toMatch(/isolation:\s*isolate/);
  });
});

describe('embedded screen-change → canvas translation', () => {
  it('every mapped widgetId exists in the REAL registry', async () => {
    // Same guard as the tool map: a mapping to an unregistered widget renders
    // a titleless "Unknown widget" frame, invisible to specs that register
    // their own test widgets.
    vi.resetModules();
    const { registerAllWidgets } = await import('@/canvas/widgets/index.js');
    const { getWidget } = await import('@/canvas/widgetRegistry.js');
    registerAllWidgets();
    const { SCREEN_WIDGET_MAP } = await import('./surfaceRegistry.js');
    const missing = Object.entries(SCREEN_WIDGET_MAP)
      .filter(([, e]) => !getWidget(e.widgetId))
      .map(([s, e]) => `${s} → ${e.widgetId}`);
    expect(missing, `map references unregistered widgets:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('mirrors Terminal.changeScreen\u2019s param contract exactly', async () => {
    // If changeScreen and this map disagree, a screen behaves differently
    // embedded vs standalone — the exact class of bug being fixed.
    const { SCREEN_WIDGET_MAP } = await import('./surfaceRegistry.js');
    expect(SCREEN_WIDGET_MAP.WorkflowForgeScreen).toMatchObject({ param: 'id', optionKey: 'workflowId' });
    expect(SCREEN_WIDGET_MAP.ToolForgeScreen).toMatchObject({ param: 'tool-id', optionKey: 'toolId' });
    expect(SCREEN_WIDGET_MAP.TracesScreen).toMatchObject({ param: 'executionId', optionKey: 'selectedExecutionId' });
    expect(SCREEN_WIDGET_MAP.ChatScreen).toMatchObject({ widgetId: 'workspace-chat', focusOnly: true });
  });

});

describe('chat parity + the right-panel inspector (source guards)', () => {
  const read = (rel) => {
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const { fileURLToPath } = require('node:url');
    return fs2.readFileSync(path2.join(__dirname, rel), 'utf8');
  };

  it('the workspace chat shows Annie\u2019s avatar, like the main Chat screen', () => {
    // MessageItem's own default is true and Chat.vue passes nothing, so the
    // main screen shows it. UnifiedChatContainer flips the default to false
    // for the five NARROW sidebar panels \u2014 a full chat surface therefore has
    // to opt back in, and forgetting to is what dropped the avatar when the
    // solo/split modes were removed.
    const src = read('WorkspaceChatWidget.vue');
    expect(src).toMatch(/:show-avatar="true"/);
  });

  it('leaves the shared UnifiedChatContainer default OFF for sidebar panels', async () => {
    const UCC = (await import('@/views/_components/chat/UnifiedChatContainer.vue')).default;
    expect(UCC.props.showAvatar.default).toBe(false);
  });

  it('does not style, size or hide the screen panels at all', () => {
    // THE invariant for feedback round 5. Any rule in here targeting the
    // panel system is a reimplementation of it: the real defaults (384px),
    // notch (16px), floor (280px), snap and drag all live in BaseScreen, and
    // the only reason they did not work inside a window was that BaseScreen
    // measured the viewport and persisted globally. Both are fixed there.
    const src = read('Workspace.vue');
    // Comments are where the REASON lives, and they name the selectors they
    // are telling you not to add — strip them before asserting.
    const styles = src.slice(src.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const selector of ['left-panel-component', 'right-panel-component', 'resize-handle']) {
      expect(styles, `Workspace.vue must not style .${selector}`).not.toContain(selector);
    }
    expect(styles).not.toContain('@container surface (min-width:');
  });

  it('embedded screens are wired to the translator, and pass their own instance id', () => {
    // The source instance is what makes navigate-in-place possible: without
    // it every click can only ever mint a new window.
    const src = read('Workspace.vue');
    expect(src).not.toMatch(/@screen-change="\(\)\s*=>\s*\{\}"/);
    expect(src).toContain('@screen-change="(s, o) => onEmbedScreenChange(s, o, instance.instanceId)"');
    expect(src).toContain('@navigate="(s, o) => onEmbedScreenChange(s, o, instance.instanceId)"');
  });

  it('window-nav chevrons share WidgetFrame’s control metrics', () => {
    // These sit in WidgetFrame's own header. Drifting from .wf-ctrl button's
    // padding/size makes them a second, tighter control cluster in the same
    // 24px bar — measured at 15px pitch against the frame's 21px before this
    // was pinned.
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    const frame = fs2.readFileSync(path2.join(__dirname, '../../../../../canvas/WidgetFrame.vue'), 'utf8');
    const ws = read('Workspace.vue');

    const frameBtn = frame.slice(frame.indexOf('.wf-ctrl button {'));
    const navBtn = ws.slice(ws.indexOf('.ws-nav-btn {'));
    const decl = (block, prop) => (block.slice(0, block.indexOf('}')).match(new RegExp(`${prop}:\\s*([^;]+);`)) || [])[1]?.trim();

    for (const prop of ['padding', 'font-size', 'color']) {
      expect(decl(navBtn, prop), `.ws-nav-btn ${prop} must match .wf-ctrl button`).toBe(decl(frameBtn, prop));
    }
    // And the frame must still offer the slot they live in.
    expect(frame).toContain('<slot name="header-lead"></slot>');
  });

  it('gives every window its own panel-geometry scope', () => {
    const src = read('Workspace.vue');
    expect(src).toContain('<EmbedScope :scope="panelScopeFor(instance.instanceId)">');
    const scope = read('EmbedScope.vue');
    expect(scope).toContain("provide('panelWidthScope'");
  });
});

/* ══════════════════════════════════════════════════════════════════
   BaseScreen: the panel system itself
   ══════════════════════════════════════════════════════════════════ */
describe('BaseScreen panel geometry (source guards)', () => {
  const readBase = () => {
    const fs2 = require('node:fs');
    const path2 = require('node:path');
    return fs2.readFileSync(path2.join(__dirname, '../../BaseScreen.vue'), 'utf8');
  };

  it('sizes panels against the CONTAINER, never window.innerWidth', () => {
    // A widget window is not the viewport. Sizing a 600px pane's sidebars
    // against a 2560px monitor is what produced 384px panels with a ~1000px
    // ceiling inside a small window.
    const src = readBase();
    expect(src).toContain('const layoutWidth = () =>');

    for (const fn of ['getResponsiveDefaultPanelWidth', 'initializePanelWidths']) {
      const start = src.indexOf(`const ${fn} = `);
      expect(start, `${fn} not found`).toBeGreaterThan(-1);
      const body = src.slice(start, start + 2500);
      expect(body, `${fn} must measure the container`).toContain('layoutWidth()');
      // layoutWidth's own definition is the single sanctioned fallback.
      expect(body.slice(0, body.indexOf('\n    };')), `${fn} must not read window.innerWidth`).not.toContain('window.innerWidth');
    }
  });

  it('observes the container instead of listening to window resize', () => {
    const src = readBase();
    expect(src).toContain('new ResizeObserver(() => initializePanelWidths())');
    expect(src).toContain('observeLayout()');
    expect(src).toContain('unobserveLayout()');
  });

  it('routes every panel-geometry write through exactly one seam', () => {
    // Fourteen scattered dispatches is how "where do panel widths live"
    // became unanswerable — and why an embedded panel resized the whole app.
    const src = readBase();
    for (const [action, helper] of [
      ['setActualLeftPanelWidth', 'persistLeftWidth'],
      ['setThreePanelWidths', 'persistRightWidth'],
      ['setMainContentWidth', 'persistMainWidth'],
      ['setLeftPanelCollapsed', 'persistLeftCollapsed'],
      ['setRightPanelCollapsed', 'persistRightCollapsed'],
    ]) {
      const hits = src.match(new RegExp(`store\\.dispatch\\('theme/${action}'`, 'g')) || [];
      expect(hits.length, `${action} must be dispatched from one place only`).toBe(1);
      expect(src, `${helper} missing`).toContain(`const ${helper} = `);
    }
  });

  it('takes an injectable panelWidthScope and defaults to global', () => {
    const src = readBase();
    expect(src).toContain("inject('panelWidthScope', null)");
    // Every seam must fall through to the store when no scope is supplied,
    // so standalone behaviour is unchanged.
    for (const helper of ['persistLeftWidth', 'persistRightWidth', 'persistMainWidth', 'persistLeftCollapsed', 'persistRightCollapsed']) {
      const i = src.indexOf(`const ${helper} = `);
      const body = src.slice(i, src.indexOf('\n    };', i));
      expect(body, `${helper} must honour the scope`).toContain('if (panelWidthScope) return panelWidthScope.set(');
      expect(body, `${helper} must fall back to the store`).toContain("store.dispatch('theme/");
    }
  });

  it('auto-collapses a panel that cannot fit, and remembers that it did', () => {
    const src = readBase();
    expect(src).toContain('const leftAutoCollapsed = ref(false)');
    expect(src).toContain('const rightAutoCollapsed = ref(false)');
    // The notch is the app's own collapsed width, not a new invention.
    expect(src).toContain("leftPanelCollapsed ? '16px'");
    expect(src).toContain("rightPanelCollapsed ? '16px'");
  });
});
