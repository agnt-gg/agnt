/**
 * Regression: a widget window rendered before its definition arrives must
 * still pick up its name and icon.
 *
 * THE BUG (2026-07-26)
 * ────────────────────
 * The registry is a plain Map. `computed(() => getWidget(id))` therefore
 * registers NO reactive dependency and is frozen at whatever the registry held
 * on first render. Custom widgets are registered asynchronously — when the
 * definitions fetch resolves — so any frame that mounted first kept the
 * `undefined` it got, and rendered a window with a completely blank header
 * forever.
 *
 * WidgetCatalog had already worked around this with a private `refreshKey`,
 * which is the tell that the registry needed to be reactive at the source.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { computed, nextTick } from 'vue';

let reg;

beforeEach(async () => {
  const mod = await import('./widgetRegistry.js');
  reg = mod;
});

describe('widgetRegistry reactivity', () => {
  it('a computed that touches registryVersion sees a LATE registration', async () => {
    const id = 'cw_late_' + Math.random().toString(36).slice(2, 8);

    // Exactly WidgetFrame's pattern.
    const def = computed(() => {
      reg.registryVersion.value;
      return reg.getWidget(id);
    });

    expect(def.value).toBeUndefined(); // rendered before the fetch resolved

    reg.registerWidget(id, { name: 'Buzz Console', icon: 'fas fa-shapes' });
    await nextTick();

    expect(def.value).toBeTruthy();
    expect(def.value.name).toBe('Buzz Console');

    reg.unregisterWidget(id);
  });

  it('a computed WITHOUT the dependency stays stale — proves the mechanism', async () => {
    // Guards against someone "simplifying" the version touch back out of
    // WidgetFrame: this is what that change would reintroduce.
    const id = 'cw_stale_' + Math.random().toString(36).slice(2, 8);
    const stale = computed(() => reg.getWidget(id));

    expect(stale.value).toBeUndefined();
    reg.registerWidget(id, { name: 'Never Seen' });
    await nextTick();

    expect(stale.value).toBeUndefined();
    reg.unregisterWidget(id);
  });

  it('bumps on both register and unregister', async () => {
    const id = 'cw_bump_' + Math.random().toString(36).slice(2, 8);
    const before = reg.registryVersion.value;

    reg.registerWidget(id, { name: 'X' });
    expect(reg.registryVersion.value).toBeGreaterThan(before);

    const mid = reg.registryVersion.value;
    reg.unregisterWidget(id);
    expect(reg.registryVersion.value).toBeGreaterThan(mid);
  });

  it('still returns correct data through the normal accessors', () => {
    const id = 'cw_acc_' + Math.random().toString(36).slice(2, 8);
    reg.registerWidget(id, { name: 'Accessor', category: 'custom', isCustomWidget: true });

    expect(reg.getWidget(id)).toMatchObject({ id, name: 'Accessor' });
    expect(reg.getAllWidgets().some((w) => w.id === id)).toBe(true);

    reg.unregisterWidget(id);
    expect(reg.getWidget(id)).toBeUndefined();
  });
});
