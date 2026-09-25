import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import SvgIcon from './SvgIcon.vue';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ICON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../assets/icons');
const SVG_SOURCE = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'SvgIcon.vue'), 'utf8');
// Paint values that are not a colour the theme needs to own.
const UNPAINTED = /^(none|transparent|currentColor|url\(.*\)|white|#fff|#ffffff)$/i;

// SvgIcon used to fetch each icon over the network. It now pre-loads every file
// under src/assets/icons at build time via import.meta.glob and resolves
// synchronously, so these tests describe the glob contract: no network, a
// gradient <defs> injected into the shipped markup, and a puzzle-piece fallback
// for names we do not ship a file for.
describe('SvgIcon', () => {
  let wrapper;
  let consoleErrorSpy;

  beforeEach(() => {
    global.fetch = vi.fn();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    consoleErrorSpy.mockRestore();
  });

  it('initializes with correct props', () => {
    wrapper = shallowMount(SvgIcon, { props: { name: 'agent' } });
    expect(wrapper.props('name')).toBe('agent');
  });

  it('resolves a shipped icon synchronously, with no network request', () => {
    wrapper = shallowMount(SvgIcon, { props: { name: 'agent' } });

    // Available on first render — no await, no flushPromises.
    expect(wrapper.vm.svgContent).toContain('<svg');
    expect(wrapper.vm.svgContent).toContain('viewBox');
    expect(wrapper.html()).toContain('<svg');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('injects the gradient defs into the resolved markup', () => {
    wrapper = shallowMount(SvgIcon, { props: { name: 'agent' } });

    expect(wrapper.vm.svgContent).toContain('<defs>');
    expect(wrapper.vm.svgContent).toContain('id="SVG-Gradient"');
    expect(wrapper.vm.svgContent).toContain('id="SVG-Gradient-Dark"');
    // The defs must sit immediately after the opening <svg> tag.
    expect(wrapper.vm.svgContent).toMatch(/<svg[^>]*><defs>/i);
  });

  it('falls back to the puzzle-piece icon for an unknown name', () => {
    const known = shallowMount(SvgIcon, { props: { name: 'puzzle-piece' } });
    wrapper = shallowMount(SvgIcon, { props: { name: 'not-a-real-icon-name' } });

    expect(wrapper.vm.svgContent).not.toBe('');
    expect(wrapper.vm.svgContent).toBe(known.vm.svgContent);
    known.unmount();
  });

  // Dark mode renders icons in the theme text colour. That only works if the
  // colour an icon ships with sits on an element SvgIcon's stylesheet
  // overrides; a colour anywhere else stays baked in and vanishes on a dark
  // background (the business-* icons shipped with fill on the <svg> root).
  it('recolours every painted element of every shipped icon', () => {
    const recoloured = {
      fill: new Set(['path', 'circle', 'ellipse', 'polygon']),
      stroke: new Set(['path', 'rect']),
    };
    // The stylesheet must still carry the selectors this test relies on.
    for (const tag of recoloured.fill) expect(SVG_SOURCE).toContain(`.svg-icon ${tag}[fill]`);
    for (const tag of recoloured.stroke) expect(SVG_SOURCE).toContain(`.svg-icon ${tag}[stroke]`);
    expect(SVG_SOURCE).toContain(".svg-icon svg[fill]:not([fill='none'])");

    const offenders = [];
    for (const file of readdirSync(ICON_DIR).filter((f) => f.endsWith('.svg'))) {
      const doc = new DOMParser().parseFromString(readFileSync(resolve(ICON_DIR, file), 'utf8'), 'image/svg+xml');
      const root = doc.documentElement;
      for (const el of [root, ...root.querySelectorAll('*')]) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'defs' || el.closest('defs, mask, clipPath, linearGradient, radialGradient')) continue;
        if (/(^|;)\s*(fill|stroke)\s*:/.test(el.getAttribute('style') || '')) offenders.push(`${file}: ${tag} paints via style=`);
        for (const attr of ['fill', 'stroke']) {
          const value = el.getAttribute(attr);
          if (!value || UNPAINTED.test(value.trim())) continue;
          const ok = el === root ? attr === 'fill' : recoloured[attr].has(tag);
          if (!ok) offenders.push(`${file}: ${tag}[${attr}=${value}]`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('updates SVG when name prop changes', async () => {
    wrapper = shallowMount(SvgIcon, { props: { name: 'agent' } });
    const first = wrapper.vm.svgContent;

    await wrapper.setProps({ name: 'api' });

    expect(wrapper.vm.svgContent).toContain('<svg');
    expect(wrapper.vm.svgContent).not.toBe(first);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
