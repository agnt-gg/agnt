import { describe, expect, it, vi, beforeEach } from 'vitest';
import { clampElementToViewport, vViewportClamp } from './viewportClamp.js';

// jsdom defaults: innerWidth 1024, innerHeight 768.
// The mock mirrors a real browser: the rect INCLUDES the element's current
// `translate` correction, because clampElementToViewport measures in place.
function makeEl(rect) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => {
    const t = (el.style.translate || '').split(/\s+/).map((v) => parseFloat(v) || 0);
    const dx = t[0] || 0;
    const dy = t.length > 1 ? t[1] : 0;
    return {
      top: rect.top + dy,
      left: rect.left + dx,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width + dx,
      bottom: rect.top + rect.height + dy,
    };
  };
  return el;
}

describe('clampElementToViewport', () => {
  it('leaves an on-screen element untouched', () => {
    const el = makeEl({ top: 100, left: 100, width: 300, height: 200 });
    clampElementToViewport(el);
    expect(el.style.translate).toBe('');
  });

  it('nudges an element back inside the right and bottom edges', () => {
    // right = 1100 (76px past 1024-8), bottom = 800 (40px past 768-8).
    const el = makeEl({ top: 600, left: 800, width: 300, height: 200 });
    clampElementToViewport(el);
    expect(el.style.translate).toBe('-84px -40px');
  });

  it('nudges an element back inside the top and left edges', () => {
    const el = makeEl({ top: -30, left: -50, width: 300, height: 200 });
    clampElementToViewport(el);
    expect(el.style.translate).toBe('58px 38px');
  });

  it('caps height and scrolls when taller than the viewport', () => {
    const el = makeEl({ top: 10, left: 100, width: 300, height: 900 });
    clampElementToViewport(el);
    expect(el.style.maxHeight).toBe(`${768 - 16}px`);
    expect(el.style.overflowY).toBe('auto');
  });

  it('skips elements that are not laid out (zero rect)', () => {
    const el = makeEl({ top: 0, left: 0, width: 0, height: 0 });
    clampElementToViewport(el);
    expect(el.style.translate).toBe('');
    expect(el.style.maxHeight).toBe('');
  });

  it('does not accumulate drift across repeated clamps', () => {
    const el = makeEl({ top: 600, left: 800, width: 300, height: 200 });
    clampElementToViewport(el);
    clampElementToViewport(el);
    expect(el.style.translate).toBe('-84px -40px');
  });

  it('re-clamping an already-correct element never rewrites style (no transition re-fire)', () => {
    // The "modal keeps moving" bug: popups with `transition: all` animate any
    // translate write, so a steady-state clamp must be a strict no-op.
    const el = makeEl({ top: 600, left: 800, width: 300, height: 200 });
    clampElementToViewport(el);

    const writes = [];
    const inner = el.style;
    const proxy = new Proxy(inner, {
      set(target, prop, value) {
        if (prop === 'translate') writes.push(value);
        target[prop] = value;
        return true;
      },
    });
    Object.defineProperty(el, 'style', { get: () => proxy });

    clampElementToViewport(el);
    clampElementToViewport(el);
    expect(writes).toEqual([]);
  });

  it('leaves an on-screen element with no correction untouched on repeat clamps', () => {
    const el = makeEl({ top: 100, left: 100, width: 300, height: 200 });
    clampElementToViewport(el);
    clampElementToViewport(el);
    expect(el.style.translate).toBe('');
  });
});

describe('vViewportClamp directive lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches and removes the resize listener', () => {
    const el = makeEl({ top: 100, left: 100, width: 100, height: 100 });
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');

    vViewportClamp.mounted(el);
    expect(add).toHaveBeenCalledWith('resize', expect.any(Function));

    vViewportClamp.unmounted(el);
    expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(el.__vClampOnResize).toBeUndefined();
  });

  it('clamps on the settle timer after mount', async () => {
    vi.useFakeTimers();
    const el = makeEl({ top: 600, left: 800, width: 300, height: 200 });
    vViewportClamp.mounted(el);
    vi.advanceTimersByTime(300);
    expect(el.style.translate).toBe('-84px -40px');
    vViewportClamp.unmounted(el);
    vi.useRealTimers();
  });
});
