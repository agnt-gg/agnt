import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const source = fs.readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'BaseScreen.vue'), 'utf8');
const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm,'');

describe('BaseScreen compact presentation invariants', () => {
 it('does not persist desktop widths during a mobile resize', () => {
  for(const name of ['calculateMainContentWidth','initializePanelWidths']) {
   const match = clean.match(new RegExp(`const ${name} = \\(\\) => \\{\\s*if \\(isMobile.value\\) return;`));
   expect(match, name+' must return before its geometry writers').not.toBeNull();
  }
 });
 it('uses one existing panel instance across compact and desktop presentations', () => {
  expect((source.match(/<LeftPanel\b/g)||[])).toHaveLength(1);expect((source.match(/<RightPanel\b/g)||[])).toHaveLength(1);
  expect(source).toContain('(showLeftPanel || hasUsedMobilePanels)');expect(source).toContain('(showRightPanel || hasUsedMobilePanels)');
  expect(source).toContain('v-show="showLeftPanel"');expect(source).toContain('v-show="showRightPanel"');
 });
 it('keeps compact closure separate from persisted desktop visibility', () => {
  expect(source).toMatch(/if \(isMobile.value\) closeMobilePanel\(\);\s*else store.dispatch\('theme\/setShowLeftPanel', false\)/);
 });
 it('exposes the existing model and tools handlers to the conversation inspector', () => {
  const expose=source.slice(source.indexOf('expose({'),source.indexOf('});',source.indexOf('expose({')));
  expect(expose).toContain('toggleProviderSelector');expect(expose).toContain('toggleToolSelector');
 });
 it('keeps one routed main slot and conversation-keyed draft', () => {
  expect((source.match(/<slot :terminal-lines/g)||[])).toHaveLength(1);
  expect(source).toContain("watch(currentUserInput, (v) => setDraft(draftKey.value, v), { flush: 'sync' })");
 });
});
