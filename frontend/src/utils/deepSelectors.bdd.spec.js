// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, compileStyle } from '@vue/compiler-sfc';

const root = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  ['views/_components/common/CreditPurchase.vue', ['.StripeElement', '.StripeElement--focus', '.StripeElement--invalid'].map(s => [`::v-deep ${s}`, `:deep(${s})`])],
  ['views/Terminal/CenterPanel/screens/Connectors/Connectors.vue', [['::v-deep .col-actions', ':deep(.col-actions)']]],
  ['views/Terminal/CenterPanel/screens/WorkflowForge/components/WorkflowDesigner/components/Canvas/components/Widgets/MarkdownPreview.vue', ['h1', 'h2', 'h3', 'code', 'pre', 'pre code', 'a', 'a:hover', 'ul', 'li', 'img', 'p'].map(s => [`.markdown-preview >>> ${s}`, `.markdown-preview :deep(${s})`])],
];
function styles(file) {
  const result = parse(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
  expect(result.errors).toEqual([]);
  return result.descriptor.styles;
}
function compile(source, scoped) {
  const result = compileStyle({ source, filename: 'contract.vue', id: 'data-v-contract', scoped });
  expect(result.errors).toEqual([]);
  return result.code;
}
function vueFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? vueFiles(p) : e.name.endsWith('.vue') ? [path.relative(root, p)] : [];
  });
}

describe('Given Vue scoped styles with deep descendants', () => {
  it.each(cases)('When %s is compiled, Then modern deep selectors emit no deprecation warnings', (file, pairs) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const blocks = styles(file);
      const source = blocks.map(s => s.content).join('\n');
      for (const [, modern] of pairs) expect(source).toContain(modern + ' {');
      for (const block of blocks) compile(block.content, block.scoped);
      expect(warn.mock.calls.flat().join('\n')).not.toMatch(/deprecated/i);
    } finally { warn.mockRestore(); }
  });

  it.each(cases)('When %s migrates, Then compiled CSS is identical to the legacy selector form', (file, pairs) => {
    // Reconstruct only the pinned old selectors; declarations and every other
    // style remain the same. This catches moving :deep() across a scope boundary.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const block of styles(file)) {
        let legacy = block.content;
        for (const [old, modern] of pairs) legacy = legacy.replace(modern + ' {', old + ' {');
        expect(compile(block.content, block.scoped)).toBe(compile(legacy, block.scoped));
      }
    } finally { warn.mockRestore(); }
  });

  it('When any source SFC is added or edited, Then its style blocks cannot reintroduce deprecated deep combinators', () => {
    const offenders = [];
    for (const file of vueFiles(root)) {
      for (const block of styles(file)) {
        const css = block.content.replace(/\/\*[\s\S]*?\*\//g, '');
        if (/::v-deep(?!\s*\()|>>>|\/deep\//.test(css)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
