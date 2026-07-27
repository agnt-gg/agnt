/**
 * Regression: re-fetching the widget catalog must not blank live widgets.
 *
 * THE BUG (2026-07-26)
 * ────────────────────
 * GET /widget-definitions deliberately strips `source_code` to keep this store
 * flat (WidgetDefinitionService.getAllWidgets). SET_DEFINITIONS replaced
 * `state.definitions` wholesale with those stripped rows, so every definition
 * that had already been hydrated LOST its body.
 *
 * CustomWidgetRenderer reads the body from exactly here:
 *     sourceCode = liveDefinition?.source_code ?? props.definition?.source_code ?? ''
 * so the instant anything re-listed the catalog, every mounted custom widget
 * collapsed to an empty iframe — and stayed empty, because the renderer only
 * asked for the body once, from setup().
 *
 * Symptom as reported: "why do my widgets crash when I open the widget menu".
 * Opening a picker refreshes the catalog; the refresh emptied them.
 *
 * The store must therefore carry hydrated bodies across a re-list.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/canvas/widgetRegistry.js', () => ({
  registerCustomWidget: vi.fn(),
  unregisterWidget: vi.fn(),
}));
vi.mock('@/canvas/CustomWidgetRenderer.vue', () => ({ default: { name: 'CustomWidgetRenderer' } }));

let mutations;

beforeEach(async () => {
  vi.resetModules();
  mutations = (await import('./widgetDefinitions.js')).default.mutations;
});

const hydrated = (over = {}) => ({
  id: 'cw_1', name: 'Buzz Console', updated_at: '2026-07-26 10:00:00',
  source_code: '<h1>live</h1>', ...over,
});
/** What the list endpoint actually returns — no source_code key at all. */
const listed = (over = {}) => {
  const { source_code, ...rest } = hydrated(over);
  return rest;
};

describe('SET_DEFINITIONS — hydration preservation', () => {
  it('keeps source_code when the re-listed row is unchanged', () => {
    const state = { definitions: [hydrated()] };
    mutations.SET_DEFINITIONS(state, [listed()]);

    expect(state.definitions[0].source_code).toBe('<h1>live</h1>');
    expect('source_code' in state.definitions[0]).toBe(true);
  });

  it('drops stale source_code when the row changed on the server', () => {
    // A stale body is worse than a re-fetch: the widget would render an old
    // build indefinitely. Losing it here makes the renderer re-hydrate.
    const state = { definitions: [hydrated()] };
    mutations.SET_DEFINITIONS(state, [listed({ updated_at: '2026-07-26 11:30:00' })]);

    expect('source_code' in state.definitions[0]).toBe(false);
    expect(state.definitions[0].updated_at).toBe('2026-07-26 11:30:00');
  });

  it('prefers a body the server DID send', () => {
    const state = { definitions: [hydrated()] };
    mutations.SET_DEFINITIONS(state, [hydrated({ source_code: '<h1>newer</h1>' })]);
    expect(state.definitions[0].source_code).toBe('<h1>newer</h1>');
  });

  it('retains nothing new — memory stays flat for widgets never loaded', () => {
    const state = { definitions: [] };
    mutations.SET_DEFINITIONS(state, [listed(), listed({ id: 'cw_2' })]);
    expect(state.definitions.every((d) => !('source_code' in d))).toBe(true);
  });

  it('handles removals, additions and empty payloads without carrying ghosts', () => {
    const state = { definitions: [hydrated(), hydrated({ id: 'cw_2' })] };

    mutations.SET_DEFINITIONS(state, [listed({ id: 'cw_2' }), listed({ id: 'cw_3' })]);
    expect(state.definitions.map((d) => d.id)).toEqual(['cw_2', 'cw_3']);
    expect(state.definitions[0].source_code).toBe('<h1>live</h1>'); // preserved
    expect('source_code' in state.definitions[1]).toBe(false);      // never had one

    mutations.SET_DEFINITIONS(state, []);
    expect(state.definitions).toEqual([]);
  });

  it('still syncs every definition to the registry', async () => {
    const { registerCustomWidget } = await import('@/canvas/widgetRegistry.js');
    registerCustomWidget.mockClear();

    const state = { definitions: [hydrated()] };
    mutations.SET_DEFINITIONS(state, [listed(), listed({ id: 'cw_2' })]);

    expect(registerCustomWidget).toHaveBeenCalledTimes(2);
    // and it syncs the PRESERVED row, not the stripped one — otherwise the
    // registry's customDefinition would hand the renderer a body-less object.
    expect(registerCustomWidget.mock.calls[0][0].source_code).toBe('<h1>live</h1>');
  });

  it('survives malformed rows', () => {
    const state = { definitions: [hydrated(), null] };
    expect(() => mutations.SET_DEFINITIONS(state, [null, listed()])).not.toThrow();
    expect(state.definitions[1].source_code).toBe('<h1>live</h1>');
  });
});
