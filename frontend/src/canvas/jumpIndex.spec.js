import { describe, it, expect } from 'vitest';
import { buildJumpIndex, flatten, matches } from './jumpIndex.js';
import { ALL_SECTIONS } from './sections.js';

const src = {
  sections: ALL_SECTIONS,
  agents: [{ id: 'a1', name: 'Release Marshal', category: 'devops', status: 'active' }],
  workflows: [{ id: 'w1', name: 'Stripe Webhook Handler', status: 'active' }],
  goals: [{ id: 'g1', title: 'Ship native mobile shell', status: 'executing' }],
  chats: [{ id: 'c1', title: 'Mobile design study' }],
  approvals: 3,
  hasProvider: true,
};

describe('jumpIndex', () => {
  it('matches every token, case-insensitively, empty query matches all', () => {
    expect(matches('', 'x')).toBe(true);
    expect(matches('stripe hooks', 'Stripe Webhook Handler')).toBe(false);
    expect(matches('stripe hand', 'Stripe Webhook Handler')).toBe(true);
  });

  it('lists every section screen under Go to, including SYSTEM and contextual ones', () => {
    const { groups } = buildJumpIndex(src);
    const goto = groups.find((g) => g.id === 'goto').items;
    const screens = goto.map((i) => i.action.screen);
    for (const s of ['ChatScreen', 'ArtifactsScreen', 'ToolsScreen', 'ToolForgeScreen', 'MemoryScreen', 'AutonomyScreen', 'SettingsScreen']) {
      expect(screens).toContain(s);
    }
    // The first screen of a section is labelled with the section name.
    expect(goto.find((i) => i.action.screen === 'ToolsScreen').label).toBe('Library');
    expect(goto.find((i) => i.action.screen === 'ArtifactsScreen').label).toBe('Files');
    expect(goto.find((i) => i.action.screen === 'TracesScreen').label).toBe('Runs');
    expect(goto.find((i) => i.action.screen === 'SkillsScreen').label).toBe('Library › Skills');
  });

  it('opens entities as inspect actions on their owning screen', () => {
    const { groups } = buildJumpIndex({ ...src, query: 'marshal' });
    const open = groups.find((g) => g.id === 'open').items;
    expect(open).toHaveLength(1);
    expect(open[0].action).toEqual({ type: 'inspect', kind: 'agent', id: 'a1', screen: 'AgentsScreen' });
  });

  it('surfaces pending approvals and a missing provider as the first verbs', () => {
    const a = buildJumpIndex({ ...src, query: 'approv' });
    expect(a.groups.find((g) => g.id === 'do').items[0].label).toMatch(/3 pending approvals/);
    const b = buildJumpIndex({ ...src, hasProvider: false, query: 'provider' });
    // Naming the section matters as much as naming the screen: Connections
    // opens on API / OAuth by default, so a bare screen jump would land one
    // click away from the thing the verb promised.
    expect(b.groups.find((g) => g.id === 'do').items[0].action).toMatchObject({ screen: 'ConnectorsScreen', opts: { section: 'providers' } });
  });

  it('falls through to Annie when nothing matches, and never when something does', () => {
    const none = buildJumpIndex({ ...src, query: 'why did the digest fail' });
    expect(none.groups).toEqual([]);
    expect(none.fallthrough.action).toEqual({ type: 'ask', text: 'why did the digest fail' });
    expect(flatten(none)).toHaveLength(1);
    const some = buildJumpIndex({ ...src, query: 'goal' });
    expect(some.fallthrough).toBeNull();
    expect(flatten(some).length).toBeGreaterThan(1);
  });

  it('strips the private haystack from every row', () => {
    const { groups } = buildJumpIndex(src);
    for (const g of groups) for (const i of g.items) expect(i._hay).toBeUndefined();
  });
});
