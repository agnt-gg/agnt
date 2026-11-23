import { describe, it, expect } from 'vitest';
import { annotateEntityRefs, compileEntityMatchers, entityRegistryFromStore } from './entityRefs.js';

const E = [
  { kind: 'agent', id: 'a1', name: 'Release Marshal', screen: 'AgentsScreen' },
  { kind: 'workflow', id: 'w1', name: 'Stripe Webhook Handler', screen: 'WorkflowsScreen' },
  { kind: 'workflow', id: 'w2', name: 'Stripe', screen: 'WorkflowsScreen' },
  { kind: 'agent', id: 'a2', name: 'Data', screen: 'AgentsScreen' },
];

describe('annotateEntityRefs', () => {
  it('wraps a whole-word mention with kind, id and screen', () => {
    const out = annotateEntityRefs('<p>Ask Release Marshal to tag it.</p>', E);
    expect(out).toContain('<span class="entity-ref" data-kind="agent" data-id="a1" data-screen="AgentsScreen">Release Marshal</span>');
  });

  it('prefers the longest name at an overlap', () => {
    const out = annotateEntityRefs('<p>Stripe Webhook Handler fired.</p>', E);
    expect(out).toContain('data-id="w1"');
    expect(out).not.toContain('data-id="w2"');
  });

  it('is case-sensitive and whole-word, so "data" does not light the agent "Data"', () => {
    expect(annotateEntityRefs('<p>the data is here</p>', E)).not.toContain('entity-ref');
    expect(annotateEntityRefs('<p>ask Data now</p>', E)).toContain('data-id="a2"');
    expect(annotateEntityRefs('<p>Database</p>', E)).not.toContain('entity-ref');
  });

  it('never touches code, pre, links, mention pills, or existing refs', () => {
    const html = '<p>See <code>Release Marshal</code> and <a href="#">Release Marshal</a> and <pre>Release Marshal</pre> <span class="mention-pill">@Release Marshal</span> <span class="entity-ref" data-kind="agent" data-id="a1">Release Marshal</span></p>';
    const out = annotateEntityRefs(html, E);
    expect((out.match(/entity-ref/g) || []).length).toBe(1);
  });

  it('caps wraps per entity so a long reply is not a wall of chips', () => {
    const html = '<p>' + Array(6).fill('Release Marshal').join(' and ') + '</p>';
    const out = annotateEntityRefs(html, E, { maxPerEntity: 2 });
    expect((out.match(/entity-ref/g) || []).length).toBe(2);
  });

  it('leaves html untouched with no registry, and ignores tiny names', () => {
    expect(annotateEntityRefs('<p>x</p>', [])).toBe('<p>x</p>');
    expect(compileEntityMatchers([{ kind: 'agent', id: 1, name: 'ab' }])).toEqual([]);
  });

  it('escapes attribute values', () => {
    const out = annotateEntityRefs('<p>Bad Agent</p>', [{ kind: 'agent', id: 'x"y', name: 'Bad Agent' }]);
    expect(out).toContain('data-id="x&quot;y"');
  });

  it('builds a registry from the three stores it reads', () => {
    const store = { getters: { 'agents/allAgents': [{ id: 1, name: 'A' }], 'workflows/allWorkflows': [{ id: 2, name: 'W' }], 'goals/allGoals': [{ id: 3, title: 'G' }] } };
    expect(entityRegistryFromStore(store).map((e) => e.kind)).toEqual(['agent', 'workflow', 'goal']);
  });
});

describe('compiled once per registry', () => {
  // A missing list (undefined getter) is the common case for goals before they load.
  const getters = (agents, workflows, goals) => ({ getters: { 'agents/allAgents': agents, 'workflows/allWorkflows': workflows, 'goals/allGoals': goals } });
  it('the same store lists give back the same registry, and its matchers are compiled once', () => {
    const agents = [{ id: 'a1', name: 'Release Marshal' }];
    const workflows = [{ id: 'w1', name: 'Nightly Backup' }];
    const first = entityRegistryFromStore(getters(agents, workflows));
    expect(entityRegistryFromStore(getters(agents, workflows))).toBe(first);
    expect(compileEntityMatchers(first)).toBe(compileEntityMatchers(first));
  });
  it('a changed list, or one that grew in place, gives a new registry', () => {
    const agents = [{ id: 'a1', name: 'Release Marshal' }];
    const first = entityRegistryFromStore(getters(agents));
    agents.push({ id: 'a2', name: 'Scout Agent' });
    const grown = entityRegistryFromStore(getters(agents));
    expect(grown).not.toBe(first);
    expect(grown.map((e) => e.name)).toEqual(['Release Marshal', 'Scout Agent']);
    expect(entityRegistryFromStore(getters([...agents]))).not.toBe(grown);
  });
  it('still links every name it finds, and leaves text without one alone', () => {
    const registry = [{ kind: 'agent', id: 'a1', name: 'Release Marshal' }, { kind: 'workflow', id: 'w1', name: 'Nightly Backup' }];
    expect(annotateEntityRefs('<p>Ask Release Marshal to run Nightly Backup.</p>', registry)).toBe('<p>Ask <span class="entity-ref" data-kind="agent" data-id="a1">Release Marshal</span> to run <span class="entity-ref" data-kind="workflow" data-id="w1">Nightly Backup</span>.</p>');
    expect(annotateEntityRefs('<p>Nothing to link here.</p>', registry)).toBe('<p>Nothing to link here.</p>');
  });
});
