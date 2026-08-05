/**
 * Widget change notification — behaviour + a systemic control.
 *
 * The bug this guards against: the frontend caches widget `source_code` for the
 * life of the page, so a widget row that changes server-side renders stale
 * until a full reload. The cure is that EVERY write path announces itself.
 * A notifier that 9 of 10 writers remember to call is not a fix — it's a fix
 * that looks like a fix. Hence `describe('mutation coverage')` below, which
 * reads the real source and fails the build on an unannounced write.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_SRC = path.resolve(__dirname, '..');

// ─────────────────────────────────────────────────────────────
// Behaviour
// ─────────────────────────────────────────────────────────────
describe('notifyWidgetChanged', () => {
  let emitted;
  let toRooms;

  beforeEach(() => {
    emitted = [];
    toRooms = [];
    global.io = {
      emit: (event, data) => emitted.push({ scope: 'global', event, data }),
      to: (room) => {
        toRooms.push(room);
        return { emit: (event, data) => emitted.push({ scope: room, event, data }) };
      },
      sockets: { adapter: { rooms: new Map() } },
    };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    delete global.io;
    vi.restoreAllMocks();
  });

  async function load() {
    const mod = await import('./widgetChangeNotifier.js');
    return mod.notifyWidgetChanged;
  }

  it('scopes the event to the owner room when a userId is known', async () => {
    const notify = await load();
    const ok = notify({ widgetId: 'cw_abc', userId: 'user-1', action: 'updated' });

    expect(ok).toBe(true);
    expect(toRooms).toEqual(['user:user-1']);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].event).toBe('widget:updated');
    expect(emitted[0].data.id).toBe('cw_abc');
  });

  it.each([
    ['created', 'widget:created'],
    ['updated', 'widget:updated'],
    ['deleted', 'widget:deleted'],
  ])('maps action %s to %s', async (action, event) => {
    const notify = await load();
    notify({ widgetId: 'cw_abc', userId: 'u', action });
    expect(emitted[0].event).toBe(event);
  });

  it('falls back to a global broadcast when there is no real owner', async () => {
    const notify = await load();
    // Desktop installs and plugin loaders write rows with no request context.
    // Emitting nothing there would resurrect the stale-render bug for exactly
    // the single-user case AGNT ships as its default.
    for (const userId of [undefined, null, '', 'anonymous']) {
      emitted = [];
      toRooms = [];
      expect(notify({ widgetId: 'cw_abc', userId })).toBe(true);
      expect(toRooms).toEqual([]);
      expect(emitted[0].scope).toBe('global');
      expect(emitted[0].event).toBe('widget:updated');
    }
  });

  it('carries an ISO updatedAt so a client can tell how fresh the row is', async () => {
    const notify = await load();
    notify({ widgetId: 'cw_abc', userId: 'u' });
    expect(emitted[0].data.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  it('emits nothing without a widgetId, and does not throw', async () => {
    const notify = await load();
    expect(notify({ userId: 'u' })).toBe(false);
    expect(notify()).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it('refuses an unknown action rather than emitting a garbage event name', async () => {
    const notify = await load();
    expect(notify({ widgetId: 'cw_abc', userId: 'u', action: 'frobnicated' })).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it('never throws when Socket.IO is absent — a write must not fail on a missed notify', async () => {
    delete global.io;
    const notify = await load();
    expect(() => notify({ widgetId: 'cw_abc', userId: 'u' })).not.toThrow();
  });

  it('never throws when the socket layer itself blows up', async () => {
    global.io = {
      to: () => {
        throw new Error('adapter exploded');
      },
      emit: () => {
        throw new Error('adapter exploded');
      },
      sockets: { adapter: { rooms: new Map() } },
    };
    const notify = await load();
    expect(notify({ widgetId: 'cw_abc', userId: 'u' })).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// Systemic control
// ─────────────────────────────────────────────────────────────
describe('mutation coverage', () => {
  /** Recursively collect .js files under a directory. */
  function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(full, out);
      } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
        out.push(full);
      }
    }
    return out;
  }

  const MUTATION = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+widget_definitions\b/i;

  // A write is "announced" if notifyWidgetChanged is called later in the SAME
  // function. A fixed line-window was the obvious first cut and it was wrong
  // in both directions: updateWidget's own notify sits 52 lines below its
  // UPDATE (false positive), while a 60-line window would happily credit a
  // write with a notify belonging to the next method (false negative).
  // Stopping at the next function boundary is a cheap, honest proxy for
  // "same function" that needs no parser.
  // `(?!if|for|while|switch|catch|else\b)` matters: a bare `[\w$]+\s*\(...\)\s*{`
  // also matches `if (options.sourcePlugin) {`, which ended importWidgetEnvelope
  // early and reported its own notify as missing.
  const CONTROL_FLOW = /^(if|for|while|switch|catch|else|do|try|return)$/;
  const FUNCTION_BOUNDARY_RE =
    /^\s{0,4}(?:export\s+)?(?:async\s+)?(?:function\s+[\w$]+|([\w$]+)\s*\([^)]*\)\s*\{\s*$)/;

  function isFunctionBoundary(line) {
    const m = FUNCTION_BOUNDARY_RE.exec(line);
    if (!m) return false;
    return !(m[1] && CONTROL_FLOW.test(m[1]));
  }

  /** True when the write at `lines[i]` is followed by a notify in the same function. */
  function isAnnounced(lines, i) {
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].includes('notifyWidgetChanged')) return true;
      if (isFunctionBoundary(lines[j])) return false;
    }
    return false;
  }

  // Writes that legitimately do not notify. Each needs a reason — an
  // allowlist without justifications becomes a place to hide regressions.
  const ALLOWED = [
    {
      file: 'models/WidgetDefinitionModel.js',
      why: 'DDL only (CREATE TABLE / CREATE INDEX / ALTER) — no row data changes.',
    },
    {
      file: 'models/database/index.js',
      why: 'Schema bootstrap and migrations, run before any client is connected.',
    },
    {
      file: 'plugins/PluginAssetLoader.js',
      why: 'Plugin install/uninstall already triggers a full catalog refetch via plugin:installed / plugin:uninstalled.',
    },
    {
      file: 'routes/PluginRoutes.js',
      why: 'Read-only subselect inside a plugin status query.',
    },
  ];

  function isAllowed(relPath) {
    return ALLOWED.some((a) => relPath.replace(/\\/g, '/').endsWith(a.file));
  }

  it('every widget_definitions write is announced (or explicitly allowlisted)', () => {
    const unannounced = [];

    for (const file of walk(BACKEND_SRC)) {
      const rel = path.relative(BACKEND_SRC, file).replace(/\\/g, '/');
      if (isAllowed(rel)) continue;

      const lines = fs.readFileSync(file, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!MUTATION.test(lines[i])) continue;
        if (!isAnnounced(lines, i)) {
          unannounced.push(`${rel}:${i + 1}  ${lines[i].trim().slice(0, 90)}`);
        }
      }
    }

    expect(
      unannounced,
      'These write widget_definitions without calling notifyWidgetChanged, so the ' +
        'frontend will render a stale widget until a full page reload. Either call ' +
        'the notifier, or add the file to ALLOWED with a written justification.\n' +
        unannounced.join('\n'),
    ).toEqual([]);
  });

  it('the control is not vacuous — it detects an unannounced write', () => {
    // Negative control. If the detector silently stopped matching (a schema
    // rename, a regex typo), the test above would pass by finding nothing at
    // all. This proves it still fires.
    const fixture = [
      'function save() {',
      "  db.run('UPDATE widget_definitions SET source_code = ? WHERE id = ?', [src, id]);",
      '}',
    ];
    expect(isAnnounced(fixture, 1)).toBe(false);
  });

  it('the control accepts a write that IS announced', () => {
    const fixture = [
      'function save() {',
      "  db.run('UPDATE widget_definitions SET source_code = ? WHERE id = ?', [src, id]);",
      "  notifyWidgetChanged({ widgetId: id, userId, action: 'updated' });",
      '}',
    ];
    expect(isAnnounced(fixture, 1)).toBe(true);
  });

  it('the control accepts a notify far below the write in the same function', () => {
    // updateWidget's real shape: ~50 lines of SQL between the write and the
    // notify. A line-window check failed this case.
    const fixture = [
      '  async updateWidget(req, res) {',
      "    db.run('UPDATE widget_definitions SET name = ? WHERE id = ?', [n, id]);",
      ...Array.from({ length: 60 }, (_, k) => `    // filler ${k}`),
      "    notifyWidgetChanged({ widgetId, userId, action: 'updated' });",
      '  }',
    ];
    expect(isAnnounced(fixture, 1)).toBe(true);
  });

  it('a control-flow block does not end the enclosing function', () => {
    // The exact false positive that flagged importWidgetEnvelope.
    const fixture = [
      'export async function importWidgetEnvelope(envelope, userId, options) {',
      "  db.run('INSERT INTO widget_definitions (id) VALUES (?)', [id]);",
      '  if (options.sourcePlugin) {',
      "    db.run('UPDATE widget_definitions SET source_plugin = ?', [p]);",
      '  }',
      "  notifyWidgetChanged({ widgetId: id, userId, action: 'created' });",
      '}',
    ];
    expect(isAnnounced(fixture, 1)).toBe(true);
    expect(isFunctionBoundary('  if (options.sourcePlugin) {')).toBe(false);
    expect(isFunctionBoundary('  async updateWidget(req, res) {')).toBe(true);
  });

  it('the control does NOT credit a notify that belongs to the next function', () => {
    // The false-negative a bigger window would have introduced.
    const fixture = [
      '  async writeButSilent(req, res) {',
      "    db.run('UPDATE widget_definitions SET name = ? WHERE id = ?', [n, id]);",
      '  }',
      '',
      '  async someoneElse(req, res) {',
      "    notifyWidgetChanged({ widgetId, userId, action: 'updated' });",
      '  }',
    ];
    expect(isAnnounced(fixture, 1)).toBe(false);
  });

  it('the three widget events are registered in RealtimeEvents', async () => {
    const { RealtimeEvents } = await import('./realtimeSync.js');
    expect(RealtimeEvents.WIDGET_CREATED).toBe('widget:created');
    expect(RealtimeEvents.WIDGET_UPDATED).toBe('widget:updated');
    expect(RealtimeEvents.WIDGET_DELETED).toBe('widget:deleted');
  });

  it('the frontend actually listens for every event the backend can emit', () => {
    // The two halves live in different build trees, so nothing but a test
    // couples them. An emitted event with no listener is a silent no-op —
    // exactly the failure mode this whole change exists to remove.
    const sync = fs.readFileSync(
      path.resolve(BACKEND_SRC, '../../frontend/src/composables/useRealtimeSync.js'),
      'utf8',
    );
    for (const event of ['widget:created', 'widget:updated', 'widget:deleted']) {
      expect(sync, `useRealtimeSync.js has no handler for ${event}`).toContain(`socket.on('${event}'`);
    }
  });
});
