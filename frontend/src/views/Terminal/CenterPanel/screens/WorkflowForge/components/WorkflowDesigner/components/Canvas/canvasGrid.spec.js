/**
 * The dot grid lives on the untransformed viewport (#canvas-container), never
 * on a finite layer inside the zoomed #canvas, which is what ran out.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Canvas.vue'), 'utf8');
const rule = (selector) => (src.match(new RegExp(`\\n${selector.replace(/[#.]/g, '\\$&')} \\{([^}]*)\\}`)) || [])[1] || '';

describe('Workflow Forge dot grid', () => {
  it('is painted on the viewport and moved by gridLayout', () => {
    const container = rule('#canvas-container');
    expect(container).toMatch(/background-image:\s*radial-gradient\(circle, var\(--canvas-grid-dot\)/);
    expect(container).toMatch(/background-size:\s*var\(--grid-spacing/);
    expect(container).toMatch(/background-position:\s*var\(--grid-x/);
  });

  it('is not drawn on the transformed layer any more', () => {
    expect(rule('.grid-overlay')).not.toMatch(/radial-gradient/);
  });

  it('follows every pan and zoom, and every resize', () => {
    const transform = src.slice(src.indexOf('updateCanvasTransform() {'), src.indexOf('updateGrid() {'));
    expect(transform).toMatch(/this\.updateGrid\(\)/);
    expect(src).toMatch(/new ResizeObserver\(\(\) => this\.updateGrid\(\)\)/);
    expect(src).toMatch(/this\._gridObserver\?\.disconnect\(\)/);
  });

  // A top-level comment made the component a fragment in the production
  // build: this.$el became a text node and ResizeObserver.observe threw.
  it('has exactly one root element, so this.$el is the container', () => {
    const template = src.slice(src.indexOf('<template>') + '<template>'.length, src.indexOf('<div', src.indexOf('<template>')));
    expect(template.trim()).toBe('');
  });

  it('the bare viewport around a zoomed-out canvas still pans and zooms', () => {
    for (const handler of ['@mousedown.self.prevent="startPanning"', '@wheel.self="handleZoom"', '@drop.self="handleDrop"']) {
      expect(src).toContain(handler);
    }
  });
});
