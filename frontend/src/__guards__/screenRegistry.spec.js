/**
 * GUARD — screenRegistry is the single source of truth for screen layout.
 *
 * Before this registry existed, 24 screens configured <BaseScreen> in five
 * different prop dialects, and "which screens get which panels" lived only
 * in 24 separate templates. These tests make that regression impossible:
 *
 *  1. Every routed screen has a registry entry.
 *  2. No screen template re-introduces a STATIC layout prop — static layout
 *     belongs in the registry. Dynamic bindings (`:activeRightPanel="ref"`)
 *     stay in the screen, because the prop deliberately wins.
 *  3. Registry values point at panel types that actually exist (or are the
 *     documented null-derive).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { SCREEN_DEFAULTS, resolvePanel, resolveInput } from '../views/Terminal/CenterPanel/screenRegistry.js';

const SRC = path.resolve(__dirname, '..');
const SCREENS_DIR = path.join(SRC, 'views/Terminal/CenterPanel/screens');

/** Every screen-root .vue that renders <BaseScreen>. */
const screenRoots = () => {
  const out = [];
  for (const entry of fs.readdirSync(SCREENS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(SCREENS_DIR, entry.name))) {
      if (!f.endsWith('.vue')) continue;
      const p = path.join(SCREENS_DIR, entry.name, f);
      const raw = fs.readFileSync(p, 'utf8');
      if (raw.includes('<BaseScreen')) out.push({ dir: entry.name, file: f, raw });
    }
  }
  return out;
};

const baseScreenTag = (raw) => raw.match(/<BaseScreen[\s\S]*?>/)?.[0] ?? '';

describe('every screen is declared in the registry', () => {
  it('finds a plausible number of screens', () => {
    expect(screenRoots().length).toBeGreaterThanOrEqual(20);
  });

  it('each screenId used by a screen root has a SCREEN_DEFAULTS entry', () => {
    const missing = [];
    for (const { dir, file, raw } of screenRoots()) {
      const id = baseScreenTag(raw).match(/\bscreenId="([^"]+)"/)?.[1];
      if (!id) continue; // dynamic screenId — nothing to assert
      if (!(id in SCREEN_DEFAULTS)) missing.push(`${dir}/${file} → ${id}`);
    }
    expect(missing, `screens with no registry entry:\n${missing.join('\n')}`).toEqual([]);
  });

  it('the registry carries no orphan entries for deleted screens', () => {
    const liveIds = new Set(
      screenRoots()
        .map(({ raw }) => baseScreenTag(raw).match(/\bscreenId="([^"]+)"/)?.[1])
        .filter(Boolean),
    );
    const orphans = Object.keys(SCREEN_DEFAULTS).filter((id) => !liveIds.has(id));
    expect(orphans, `registry entries with no screen: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('static layout stays in the registry, not in templates', () => {
  it('no screen passes a static activeRightPanel / activeLeftPanel / showInput', () => {
    const offenders = [];
    for (const { dir, file, raw } of screenRoots()) {
      const tag = baseScreenTag(raw);
      // Static string attr (no leading colon) — belongs in the registry.
      if (/[^:]\bactiveRightPanel="/.test(tag)) offenders.push(`${dir}/${file}: static activeRightPanel`);
      if (/[^:]\bactiveLeftPanel="/.test(tag)) offenders.push(`${dir}/${file}: static activeLeftPanel`);
      // Bound literal is static too: :activeLeftPanel="'X'" / :activeRightPanel="null"
      if (/:activeRightPanel="(null|'[^']*')"/.test(tag)) offenders.push(`${dir}/${file}: literal :activeRightPanel`);
      if (/:activeLeftPanel="(null|'[^']*')"/.test(tag)) offenders.push(`${dir}/${file}: literal :activeLeftPanel`);
      if (/:showInput="(true|false)"/.test(tag)) offenders.push(`${dir}/${file}: literal :showInput`);
    }
    expect(offenders, `static layout props belong in screenRegistry.js:\n${offenders.join('\n')}`).toEqual([]);
  });
});

/**
 * Panels that the registry names but that have no component file. Each entry
 * needs a reason, because the consequence is invisible: LeftPanel/RightPanel
 * catch the failed import and silently fall back to ChatPanel, so a typo here
 * ships as "the wrong panel renders", never as an error.
 */
const ALLOWED_MISSING_PANELS = new Map([
  [
    'RightPanel/DashboardPanel',
    'Never implemented. Dashboard has asked for it since long before this branch '
      + '(main passes activeRightPanel="DashboardPanel"), and RightPanel\'s catch '
      + 'falls back to ChatPanel — which is what the Dashboard has always shown on '
      + 'the right. Making it a real panel is a product decision, not a rename.',
  ],
]);

describe('registry entries resolve to real panel types', () => {
  /**
   * The exact module `loadPanel` imports: `types/<Name>/<Name>.vue`.
   * Checking only for the DIRECTORY is a false pass — an emptied panel folder
   * satisfied it right up until git pruned the folder itself.
   */
  const panelFileExists = (side, name) =>
    fs.existsSync(path.join(SRC, `views/Terminal/${side}/types`, name, `${name}.vue`));

  const missing = (side, slot) =>
    Object.entries(SCREEN_DEFAULTS)
      .filter(([, v]) => typeof v[slot] === 'string' && !panelFileExists(side, v[slot]))
      .filter(([, v]) => !ALLOWED_MISSING_PANELS.has(`${side}/${v[slot]}`))
      .map(([k, v]) => `${k} → ${side}/types/${v[slot]}/${v[slot]}.vue`);

  it('every named rightPanel has a component file', () => {
    const bad = missing('RightPanel', 'rightPanel');
    expect(bad, `these silently fall back to ChatPanel:\n${bad.join('\n')}`).toEqual([]);
  });

  it('every named leftPanel has a component file', () => {
    const bad = missing('LeftPanel', 'leftPanel');
    expect(bad, `these silently fall back to ChatPanel:\n${bad.join('\n')}`).toEqual([]);
  });

  it('every allowed-missing panel is still genuinely missing', () => {
    // Once someone implements one, the allowance must go — otherwise the list
    // rots into a permanent blind spot.
    const stale = [...ALLOWED_MISSING_PANELS.keys()].filter((key) => {
      const [side, name] = key.split('/');
      return panelFileExists(side, name);
    });
    expect(stale, `implemented — drop from ALLOWED_MISSING_PANELS: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('resolution semantics', () => {
  it('an explicitly passed prop always wins over the registry', () => {
    expect(resolvePanel('CustomPanel', 'GoalsScreen', 'rightPanel')).toBe('CustomPanel');
    expect(resolvePanel(null, 'GoalsScreen', 'rightPanel')).toBe(null);
    expect(resolveInput(true, 'GoalsScreen')).toBe(true);
  });

  it('an omitted prop falls back to the registry entry', () => {
    expect(resolvePanel(undefined, 'GoalsScreen', 'rightPanel')).toBe('GoalsPanel');
    expect(resolveInput(undefined, 'GoalsScreen')).toBe(false);
  });

  it('unknown screens keep the historical defaults (null panel, input shown)', () => {
    expect(resolvePanel(undefined, 'NoSuchScreen', 'rightPanel')).toBe(null);
    expect(resolveInput(undefined, 'NoSuchScreen')).toBe(true);
  });
});
