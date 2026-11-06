import { describe, it, expect } from 'vitest';
import {
  WORKFLOW_QUICKSTARTS,
  quickstartAvailable,
  referenceName,
  layoutQuickstart,
  QUICKSTART_GRID,
  QUICKSTART_NODE_HEIGHT,
  QUICKSTART_GAP,
  paletteCrowdsGraph,
  proNodeTitles,
} from './workflowQuickstarts.js';

// Output fields of the node types the templates use, read from the live
// /api/tools/workflow-tools schemas when these templates were written.
const OUTPUTS = {
  'trigger-timer': ['timestamp'],
  'receive-email': ['from', 'to', 'subject', 'body', 'attachments'],
  'web-search': ['results', 'error'],
  'web-scrape': ['textContent', 'links', 'codeContent', 'error'],
  'generate-with-ai-llm': ['generatedText', 'tokenCount', 'error'],
  'markdown-preview': ['markdownContent', 'htmlContent'],
  'send-email': ['success', 'messageId', 'error'],
};
const TRIGGERS = new Set(['trigger-timer', 'receive-email', 'webhook-listener']);

describe.each(WORKFLOW_QUICKSTARTS.map((t) => [t.id, t]))('quickstart %s', (_id, template) => {
  const byKey = new Map(template.nodes.map((n) => [n.key, n]));

  it('starts with exactly one trigger and names every node uniquely', () => {
    expect(template.nodes.filter((n) => TRIGGERS.has(n.type)).map((n) => n.key)).toEqual([template.nodes[0].key]);
    const refs = template.nodes.map((n) => referenceName(n.name).toLowerCase());
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('wires only nodes it defines, into one connected chain', () => {
    for (const [from, to] of template.edges) {
      expect(byKey.has(from), from).toBe(true);
      expect(byKey.has(to), to).toBe(true);
    }
    const reached = new Set([template.nodes[0].key]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const [from, to] of template.edges) if (reached.has(from) && !reached.has(to)) grew = reached.add(to);
    }
    expect([...reached].sort()).toEqual([...byKey.keys()].sort());
  });

  it('references only outputs of nodes upstream of the reference', () => {
    const upstream = (key) => {
      const seen = new Set();
      const walk = (k) => template.edges.filter(([, to]) => to === k).forEach(([from]) => !seen.has(from) && (seen.add(from), walk(from)));
      walk(key);
      return seen;
    };
    for (const node of template.nodes) {
      const text = JSON.stringify(node.params);
      for (const [, name, field] of text.matchAll(/\{\{(\w+)\.(\w+)\}\}/g)) {
        const target = template.nodes.find((n) => referenceName(n.name) === name);
        expect(target, `${node.key} references unknown node ${name}`).toBeTruthy();
        expect(upstream(node.key).has(target.key), `${name} is not upstream of ${node.key}`).toBe(true);
        expect(OUTPUTS[target.type], `${target.type} outputs`).toContain(field);
      }
    }
  });
});

describe('quickstart helpers', () => {
  it('hides a template whose node types are not all installed', () => {
    const [daily] = WORKFLOW_QUICKSTARTS;
    const all = new Set(daily.nodes.map((n) => n.type));
    expect(quickstartAvailable(daily, all)).toBe(true);
    all.delete('web-search');
    expect(quickstartAvailable(daily, all)).toBe(false);
  });

  it('lays every template out top-down in one column, trigger first', () => {
    const points = layoutQuickstart(WORKFLOW_QUICKSTARTS[0], { x: 100, startY: 16 });
    expect(points.map((p) => [p.x, p.y])).toEqual([
      [100, 16],
      [100, 160],
      [100, 304],
      [100, 448],
    ]);
    expect(points[0].node.type).toBe('trigger-timer');
  });

  // The live catalogue gates these three behind a paid plan.
  const SCHEMAS = new Map([
    ['trigger-timer', { title: 'Timer Trigger' }],
    ['web-search', { title: 'Web Search', requiresPro: true }],
    ['receive-email', { title: 'Receive Email', requiresPro: true }],
    ['send-email', { title: 'Send Email', requiresPro: true }],
    ['web-scrape', { title: 'Web Scrape' }],
    ['generate-with-ai-llm', { title: 'AI LLM Call' }],
    ['markdown-preview', { title: 'Markdown Preview' }],
  ]);

  it('names the paid nodes a template needs, and none for one that runs on any plan', () => {
    const byId = Object.fromEntries(WORKFLOW_QUICKSTARTS.map((t) => [t.id, t]));
    expect(proNodeTitles(byId['daily-brief'], SCHEMAS)).toEqual(['Web Search']);
    expect(proNodeTitles(byId['email-drafts'], SCHEMAS)).toEqual(['Receive Email']);
    expect(proNodeTitles(byId['weekly-report'], SCHEMAS)).toEqual(['Web Search', 'Send Email']);
    expect(proNodeTitles(byId['page-watch'], SCHEMAS)).toEqual([]);
  });

  it('at least one template runs on the free plan: no paid node, a timer no faster than daily', () => {
    const free = WORKFLOW_QUICKSTARTS.filter((t) => proNodeTitles(t, SCHEMAS).length === 0);
    expect(free.map((t) => t.id)).toContain('page-watch');
    const timer = free.find((t) => t.id === 'page-watch').nodes.find((n) => n.type === 'trigger-timer');
    expect(timer.params.schedule).toBe('Daily');
  });

  // Measured at 1440px in AGNT One: a 492px canvas with the open palette over
  // its first 304px leaves 188px, less than one 288px node.
  it('the open palette crowds a node only when the strip it leaves is too narrow', () => {
    expect(paletteCrowdsGraph(492, 304, 288)).toBe(true);
    expect(paletteCrowdsGraph(492, 64, 288)).toBe(false);
    expect(paletteCrowdsGraph(1200, 304, 288)).toBe(false);
    expect(paletteCrowdsGraph(492, 0, 288)).toBe(false);
    expect(paletteCrowdsGraph(0, 304, 288)).toBe(false);
  });

  // Regression: the old left-to-right step (280) was narrower than a node (288),
  // so neighbouring template nodes overlapped.
  it('stacked nodes never overlap and keep room for the connecting edge', () => {
    for (const template of WORKFLOW_QUICKSTARTS) {
      const ys = layoutQuickstart(template).map((p) => p.y);
      for (let i = 1; i < ys.length; i += 1) {
        const gap = ys[i] - ys[i - 1] - QUICKSTART_NODE_HEIGHT;
        expect(gap, template.id).toBeGreaterThanOrEqual(QUICKSTART_GAP);
        expect((ys[i] - ys[i - 1]) % QUICKSTART_GRID, template.id).toBe(0);
      }
    }
  });
});
