import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';

const src = join(dirname(fileURLToPath(import.meta.url)), '..');
function styles(file) {
  const source = readFileSync(join(src, file), 'utf8');
  return postcss.parse([...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n'));
}
function rule(root, selector) {
  let match;
  root.walkRules(r => { if (r.selector === selector) match = r; });
  expect(match, selector).toBeDefined();
  return match;
}
function property(node, name) { return node.nodes.find(n => n.prop === name); }

describe('mobile scroll surfaces and overlay paint', () => {
  it('gives Dashboard one bounded vertical scroller and natural-height children', () => {
    const css = styles('views/Terminal/CenterPanel/screens/Dashboard/Dashboard.vue');
    const scroll = rule(css, '.dashboard-screen-root .dashboard-content');
    expect(scroll.parent.params).toBe('(max-width: 800px)');
    expect(property(scroll, 'overflow-y').value).toBe('auto');
    const content = rule(css, '.dashboard-screen-root .dashboard-inner-content');
    expect(property(content, 'height').value).toBe('auto');
    expect(property(content, 'min-height').value).toBe('100%');
  });
  it('overrides the canvas direct-child clip only for mobile custom pages', () => {
    const css = styles('canvas/CanvasScreen.vue');
    const scroll = rule(css, '.cv-root.cv-compact .cv-dashboard > .widget-canvas');
    expect(property(scroll, 'overflow-y').value).toBe('auto');
    expect(property(scroll, 'overflow-x').value).toBe('hidden');
  });
  it('makes group captions full-width border-box regardless of saved rail collapse', () => {
    const css = styles('canvas/CanvasScreen.vue');
    const caption = rule(css, '.cv-root.cv-compact .cv-sidebar .cv-sb-cap');
    expect(property(caption, 'box-sizing').value).toBe('border-box');
    expect(property(caption, 'padding').value).toBe('16px 16px 8px');
    expect(property(caption, 'height').value).toBe('auto');
    expect(property(caption, 'display').value).toBe('block');
  });
  it('does not let embedded chat steal paging keys from the focused canvas', () => {
    const source=readFileSync(join(src,'views/_components/chat/UnifiedChatContainer.vue'),'utf8');
    const body=source.slice(source.indexOf('const handleKeyboardScroll ='),source.indexOf('const focusInput ='));
    const branch=body.indexOf("if (active?.matches?.('.ws-canvas, .widget-canvas')) return;");
    expect(branch).toBeGreaterThan(0);
    expect(branch).toBeLessThan(body.indexOf("event.key === 'PageDown'"));
  });
  it('uses the popup token on both visible mobile panels above wallpaper transparency', () => {
    const css = styles('views/Terminal/CenterPanel/BaseScreen.vue');
    let panels;
    css.walkRules(r => { if(r.selector.startsWith('body .terminal-content.mobile-presentation > .three-panel-container > .left-panel-component.mobile-panel-visible')) panels=r; });
    expect(panels).toBeDefined();
    expect(panels.selector).toContain('.right-panel-component.mobile-panel-visible');
    const background=property(panels,'background');
    expect(background.value).toBe('var(--color-popup)');
    expect(background.important).toBe(true);
  });
});
