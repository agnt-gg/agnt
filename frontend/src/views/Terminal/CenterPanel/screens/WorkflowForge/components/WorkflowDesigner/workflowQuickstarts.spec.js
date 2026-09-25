import { describe, it, expect } from 'vitest';
import { WORKFLOW_QUICKSTARTS, quickstartAvailable, referenceName, layoutQuickstart } from './workflowQuickstarts.js';

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

  it('lays nodes out left to right', () => {
    const points = layoutQuickstart(WORKFLOW_QUICKSTARTS[0], { startX: 100, stepX: 50, y: 10 });
    expect(points.map((p) => [p.x, p.y])).toEqual([
      [100, 10],
      [150, 10],
      [200, 10],
      [250, 10],
    ]);
  });
});
