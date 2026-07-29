/**
 * The original defect was not "the parser is wrong" — there was no tolerant
 * parser at all, and the same bare JSON.parse was duplicated in two renderers.
 * A unit test of chartConfig.js therefore proves nothing about whether either
 * renderer actually reaches it. These tests pin the wiring and the full
 * markdown -> DOM -> parse chain.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderMarkdown } from './markdownPipeline';
import { parseChartConfig } from './chartConfig';

const SRC = path.resolve(__dirname, '..');
/** Walk every non-test source file under src/, calling fn(path, text). */
const walkSource = (fn, dir = SRC) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { walkSource(fn, p); continue; }
    if (!/\.(vue|js)$/.test(entry.name)) continue;
    if (/\.(spec|test)\.js$/.test(entry.name)) continue; // a test naming the pattern is not an offender
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    fn(p, text);
  }
};

const CONSUMERS = [
  ['MessageItem.vue', path.join(SRC, 'views/Terminal/CenterPanel/screens/Chat/components/MessageItem.vue')],
  ['Artifacts.vue', path.join(SRC, 'views/Terminal/CenterPanel/screens/Artifacts/Artifacts.vue')],
];

describe('wiring: every chart renderer uses the tolerant parser', () => {
  it.each(CONSUMERS)('%s imports parseChartConfig and chartErrorHtml', (_name, file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toMatch(/import\s*\{[^}]*parseChartConfig[^}]*\}\s*from\s*'@\/utils\/chartConfig'/);
    expect(src).toMatch(/import\s*\{[^}]*chartErrorHtml[^}]*\}\s*from\s*'@\/utils\/chartConfig'/);
  });

  it.each(CONSUMERS)('%s calls parseChartConfig on the chart config', (_name, file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toMatch(/parseChartConfig\(\s*rawConfig\s*\)/);
  });

  it.each(CONSUMERS)('%s never bare-parses the chart config', (_name, file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(src).not.toMatch(/JSON\.parse\(\s*rawConfig\s*\)/);
  });

  it('no file in the tree interpolates a raw error into innerHTML', () => {
    // Visualization renderers execute model-authored content, so err.message can
    // carry arbitrary text. It must go through vizErrorHtml, which escapes it.
    const offenders = [];
    walkSource((p, text) => {
      if (/innerHTML\s*=\s*`[^`]*\$\{err\.message\}/.test(text)) offenders.push(path.basename(p));
    });
    expect(offenders).toEqual([]);
  });

  it.each(CONSUMERS)('%s builds its failure box with the shared helper', (_name, file) => {
    const src = fs.readFileSync(file, 'utf8');
    expect(src).toMatch(/container\.innerHTML\s*=\s*chartErrorHtml\(/);
  });

  it.each(CONSUMERS)('%s does not double-decode the config through a textarea', (_name, file) => {
    const src = fs.readFileSync(file, 'utf8');
    const chartBlock = src.slice(src.indexOf('.chartjs-config'), src.indexOf('.chartjs-config') + 1200);
    expect(chartBlock).not.toMatch(/textarea/i);
  });

  it('finds every chart renderer in the tree (guard cannot go vacuous)', () => {
    // A new renderer must be classified here rather than silently shipping its
    // own bare JSON.parse — which is exactly how the duplicate arose.
    const found = [];
    walkSource((p, text) => {
      if (text.includes("querySelector('.chartjs-config')")) found.push(path.basename(p));
    });
    expect(found.sort()).toEqual(['Artifacts.vue', 'MessageItem.vue']);
  });
});

describe('end-to-end: markdown -> DOM -> tolerant parse', () => {
  const renderToConfigEl = (markdown) => {
    const html = renderMarkdown(markdown, { streaming: false });
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.querySelector('.chartjs-config');
  };

  it('recovers the exact production failure through the whole chain', () => {
    const broken = '{"type":"bar","data":{"labels":["m=8 (HAWK)","m=12"],'
      + '"datasets":[{"label":"usable \u03C4 (non-conjugation, complex fixed field)","data":[2,2]}]}';
    const el = renderToConfigEl('```chartjs\n' + broken + '\n```');
    expect(el).toBeTruthy();

    const raw = el.textContent;
    expect(() => JSON.parse(raw)).toThrow(); // still broken at the DOM boundary

    const { config, repairs } = parseChartConfig(raw);
    expect(repairs).toContain('added missing closing bracket');
    expect(config.data.labels).toEqual(['m=8 (HAWK)', 'm=12']);
    expect(config.data.datasets[0].label).toBe('usable \u03C4 (non-conjugation, complex fixed field)');
  });

  it('round-trips a valid config unchanged through the whole chain', () => {
    const valid = '{"type":"bar","data":{"labels":["Jan"],"datasets":[{"data":[1]}]}}';
    const el = renderToConfigEl('```chartjs\n' + valid + '\n```');
    const { config, repairs } = parseChartConfig(el.textContent);
    expect(repairs).toEqual([]);
    expect(config).toEqual(JSON.parse(valid));
  });

  it('preserves HTML-significant characters in labels (single decode only)', () => {
    // Reading textContent decodes once. Decoding a second time — as the old
    // textarea round-trip did — would turn "A &amp; B" into "A & B".
    const cfg = { type: 'bar', data: { labels: ['A &amp; B', '<b>x</b>', 'a & b'], datasets: [{ data: [1, 2, 3] }] } };
    const el = renderToConfigEl('```chartjs\n' + JSON.stringify(cfg) + '\n```');
    const { config } = parseChartConfig(el.textContent);
    expect(config.data.labels).toEqual(['A &amp; B', '<b>x</b>', 'a & b']);
  });

  it('survives a label containing a fenced-code-like sequence', () => {
    const cfg = { type: 'bar', data: { labels: ['a } b', 'c, d'], datasets: [{ data: [1, 2] }] } };
    const el = renderToConfigEl('```chartjs\n' + JSON.stringify(cfg) + '\n```');
    expect(parseChartConfig(el.textContent).config.data.labels).toEqual(['a } b', 'c, d']);
  });
});
