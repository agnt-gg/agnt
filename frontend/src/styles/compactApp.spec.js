import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
const base = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(base, 'components/_compact-app.css'), 'utf8');
const root = postcss.parse(css);
const source = path => readFileSync(join(base, '..', path), 'utf8');

describe('whole-app compact presentation boundaries', () => {
 it('keeps every visual adaptation inside the existing compact breakpoint', () => {
  root.walkRules(rule => {
   if (['.compact-speaker', '.docs-mobile-toggle'].includes(rule.selector)) return;
   if (rule.selector === '.desktop-view-container,.mobile-section-body') { expect(rule.nodes).toHaveLength(1); expect(rule.nodes[0].prop).toBe('display'); expect(rule.nodes[0].value).toBe('contents'); return; }
   let parent=rule.parent;while(parent && !(parent.type==='atrule' && parent.name==='media'))parent=parent.parent;
   expect(parent?.params, rule.selector).toMatch(/max-width:\s*800px/);
  });
 });
 it('keeps the same file editor mounted when selecting Preview', () => {
  const s=source('views/Terminal/CenterPanel/screens/Artifacts/Artifacts.vue');
  expect(s).toContain('v-if="showCode || isMobile"');expect(s).toContain("mobileFileView === 'editor'");
  expect((s.match(/<Codemirror\b/g)||[])).toHaveLength(1);expect(css).toContain('.ce-root.ce-compact.ce-show-editor .ce-preview-half');
 });
 it('sizes workspace chat from actual remaining viewport rather than a guessed fixed subtraction', () => {
  expect(css).toContain('.ws-canvas { container-type:size; }');expect(css).toContain('height:calc(100cqh - 24px)');
  expect(css).toContain('.ws-surfaces { box-sizing:border-box; flex:0 0 auto; width:100%; }');
 });
 it('does not persist compact workspace drag/resize geometry', () => {
  const s=source('views/Terminal/CenterPanel/screens/Workspace/Workspace.vue');
  for(const handler of ['onFrameDragEnd','onFrameResizeEnd'])expect(s).toMatch(new RegExp('const '+handler+' = [^\\n]+\\n\\s*if \\(compact.value\\) return;'));
 });
 it('Docs navigation toggles the existing sidebar instead of duplicating article content', () => {
  const s=source('views/Docs/Docs.vue');expect(s).toContain('mobileContentsOpen');expect((s.match(/v-html="renderedContent"/g)||[])).toHaveLength(1);
 });
});
