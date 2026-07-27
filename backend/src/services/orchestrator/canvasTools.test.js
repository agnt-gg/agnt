/**
 * Canvas tools — schema contract + executor transport.
 *
 * The executor is a thin client of the tutorialScanRegistry rail, so what
 * matters here is: schemas are well-formed and stable, the emit targets the
 * right room with a correlatable requestId, a browser response resolves the
 * call VERBATIM (the bridge composes the full result object — mangling it
 * server-side would lose failure detail), and every failure path returns an
 * honest error instead of throwing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCanvasToolSchemas, executeCanvasTool, isCanvasTool } from './canvasTools.js';
import { resolvePendingScan } from './tutorialScanRegistry.js';

const NAMES = [
  'get_canvas_state',
  'inspect_canvas_widget',
  'open_canvas_widget',
  'close_canvas_widget',
  'move_canvas_widget',
];

describe('canvas tool schemas', () => {
  it('exposes exactly the five canvas tools with valid function schemas', () => {
    const schemas = getCanvasToolSchemas();
    expect(schemas.map((s) => s.function.name)).toEqual(NAMES);
    for (const s of schemas) {
      expect(s.type).toBe('function');
      expect(s.function.description.length).toBeGreaterThan(40);
      expect(s.function.parameters.type).toBe('object');
    }
  });

  it('requires the id arguments that address a specific window', () => {
    const byName = Object.fromEntries(getCanvasToolSchemas().map((s) => [s.function.name, s.function]));
    expect(byName.inspect_canvas_widget.parameters.required).toEqual(['instanceId']);
    expect(byName.close_canvas_widget.parameters.required).toEqual(['instanceId']);
    expect(byName.move_canvas_widget.parameters.required).toEqual(['instanceId']);
    expect(byName.open_canvas_widget.parameters.required).toEqual(['widgetId']);
  });

  it('isCanvasTool answers for exactly these names', () => {
    for (const n of NAMES) expect(isCanvasTool(n)).toBe(true);
    expect(isCanvasTool('scan_page_elements')).toBe(false);
    expect(isCanvasTool('get_canvas')).toBe(false);
  });
});

describe('executeCanvasTool transport', () => {
  let emitted;

  beforeEach(() => {
    emitted = [];
    global.io = {
      to: (room) => ({
        emit: (event, payload) => emitted.push({ room, event, payload }),
      }),
    };
  });

  afterEach(() => {
    delete global.io;
    vi.restoreAllMocks();
  });

  it('refuses without a userId, and without socket.io', async () => {
    const noUser = await executeCanvasTool('get_canvas_state', {}, null, {});
    expect(noUser.success).toBe(false);
    expect(noUser.error).toMatch(/authenticated/i);

    delete global.io;
    const noIo = await executeCanvasTool('get_canvas_state', {}, null, { userId: 'u1' });
    expect(noIo.success).toBe(false);
    expect(noIo.error).toMatch(/Socket\.IO/i);
  });

  it('rejects unknown tool names without touching the socket', async () => {
    const res = await executeCanvasTool('nuke_canvas', {}, null, { userId: 'u1' });
    expect(res.success).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it('emits to the user room with a correlatable requestId and the mapped action', async () => {
    const call = executeCanvasTool('inspect_canvas_widget', { instanceId: 'w_x' }, null, { userId: 'u42' });
    expect(emitted).toHaveLength(1);
    const { room, event, payload } = emitted[0];
    expect(room).toBe('user:u42');
    expect(event).toBe('canvas:request');
    expect(payload.requestId).toMatch(/^canvas-/);
    expect(payload.action).toBe('inspect');
    expect(payload.args).toEqual({ instanceId: 'w_x' });

    // resolve so the pending promise doesn't leak into other tests
    resolvePendingScan(payload.requestId, { success: true, found: false });
    await call;
  });

  it('returns the browser result VERBATIM when it is an object', async () => {
    const call = executeCanvasTool('get_canvas_state', {}, null, { userId: 'u1' });
    const { requestId } = emitted[0].payload;
    const browserResult = { success: true, open: true, workspaces: [{ id: 'ws_1', widgets: [] }] };
    resolvePendingScan(requestId, browserResult);
    expect(await call).toEqual(browserResult);
  });

  it('wraps a non-object response instead of inventing structure', async () => {
    const call = executeCanvasTool('get_canvas_state', {}, null, { userId: 'u1' });
    resolvePendingScan(emitted[0].payload.requestId, 42);
    expect(await call).toEqual({ success: true, result: 42 });
  });

  it('returns an error (not a throw) when the emit itself fails', async () => {
    global.io = { to: () => ({ emit: () => { throw new Error('transport down'); } }) };
    const res = await executeCanvasTool('open_canvas_widget', { widgetId: 'traces' }, null, { userId: 'u1' });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/broadcast/i);
  });

  it('maps every tool to its bridge action', async () => {
    const expected = {
      get_canvas_state: 'state',
      inspect_canvas_widget: 'inspect',
      open_canvas_widget: 'open',
      close_canvas_widget: 'close',
      move_canvas_widget: 'move',
    };
    for (const [name, action] of Object.entries(expected)) {
      emitted.length = 0;
      const call = executeCanvasTool(name, {}, null, { userId: 'u1' });
      expect(emitted[0].payload.action).toBe(action);
      resolvePendingScan(emitted[0].payload.requestId, { success: true });
      await call;
    }
  });
});
