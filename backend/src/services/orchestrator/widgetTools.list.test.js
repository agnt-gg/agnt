/**
 * list_widgets — the read side of the widget CRUD surface.
 *
 * Exists because agents without it resorted to raw /widget-definitions API
 * calls through code tools (which fail in sandboxed runtimes: no process, no
 * agnt global) just to answer "what widgets do I have?". The contract: compact
 * rows, NO source_code, category filter, honest no-user error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/WidgetDefinitionModel.js', () => ({
  default: {
    findByUserId: vi.fn(),
  },
}));

import { getWidgetToolSchemas, executeWidgetTool } from './widgetTools.js';
import WidgetDefinitionModel from '../../models/WidgetDefinitionModel.js';

// executeWidgetTool returns JSON.stringify(result) — the tool-loop contract —
// so every assertion goes through a parse. Pinned here so a refactor to raw
// objects (which would double-stringify in tools.js) shows up loudly.
const run = async (args, ctx) => {
  const raw = await executeWidgetTool('list_widgets', args, null, ctx);
  expect(typeof raw).toBe('string');
  return JSON.parse(raw);
};

const ROWS = [
  { id: 'cw_game1', name: 'Snake', category: 'custom', widget_type: 'html', description: 'Arcade snake', is_shared: 0, updated_at: '2026-07-27 01:00:00', source_code: '<html>HUGE</html>', config: '{}' },
  { id: 'cw_dash1', name: 'Run Stats', category: 'dashboard', widget_type: 'html', description: '', is_shared: 1, updated_at: '2026-07-26 12:00:00', source_code: '<html>ALSO HUGE</html>' },
];

beforeEach(() => {
  WidgetDefinitionModel.findByUserId.mockReset();
  WidgetDefinitionModel.findByUserId.mockResolvedValue(ROWS);
});

describe('list_widgets', () => {
  it('is in the widget tool schemas with an object parameter block', () => {
    const s = getWidgetToolSchemas().find((x) => x.function.name === 'list_widgets');
    expect(s).toBeTruthy();
    expect(s.function.parameters.type).toBe('object');
    expect(s.function.description).toMatch(/what widgets/i);
  });

  it('lists the user library compactly — never source_code', async () => {
    const res = await run({}, { userId: 'u1' });
    expect(res.success).toBe(true);
    expect(res.count).toBe(2);
    expect(WidgetDefinitionModel.findByUserId).toHaveBeenCalledWith('u1');
    expect(res.widgets[0]).toEqual({
      id: 'cw_game1', name: 'Snake', category: 'custom', widget_type: 'html',
      description: 'Arcade snake', is_shared: false, updated_at: '2026-07-27 01:00:00',
    });
    expect(JSON.stringify(res)).not.toContain('HUGE');
  });

  it('filters by category, case-insensitively', async () => {
    const res = await run({ category: 'Dashboard' }, { userId: 'u1' });
    expect(res.count).toBe(1);
    expect(res.widgets[0].id).toBe('cw_dash1');
  });

  it('refuses without a userId instead of leaking a global list', async () => {
    const res = await run({}, {});
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/authenticated/i);
    expect(WidgetDefinitionModel.findByUserId).not.toHaveBeenCalled();
  });
});
