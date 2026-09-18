import {
  describe,
  it,
  expect
} from 'vitest';
import {
  buildJumpCatalog
} from './jumpCatalog.js';
import {
  ALL_SECTIONS
} from './sections.js';
describe('categorized page and asset search', () => {
  it('keeps every existing screen exactly once', () => {
    const groups = buildJumpCatalog({
      sections: ALL_SECTIONS
    });
    const screens = groups.flatMap(g => g.items).filter(i => i.id.startsWith('go:')).map(i => i.action.screen);
    expect(screens.sort()).toEqual(ALL_SECTIONS.flatMap(s => s.screens.map(t => t.screen)).sort());
    expect(new Set(screens).size).toBe(screens.length);
    expect(groups).toHaveLength(6)
  });
  it('does not truncate the catalog to twelve saved objects', () => {
    const agents = Array.from({
      length: 50
    }, (_, i) => ({
      id: 'a' + i,
      name: 'Agent ' + i
    }));
    const rows = buildJumpCatalog({
      sections: ALL_SECTIONS,
      agents
    }).flatMap(g => g.items);
    expect(rows.filter(i => i.id.startsWith('agent:'))).toHaveLength(50)
  });
  it('includes actual tools/skills and keeps data as labels', () => {
    const rows = buildJumpCatalog({
      sections: ALL_SECTIONS,
      tools: [{
        id: 'x',
        name: '<img onerror=bad>'
      }],
      skills: [{
        id: 's',
        name: 'Review'
      }]
    }).flatMap(g => g.items);
    expect(rows.find(i => i.id === 'tool:x').label).toBe('<img onerror=bad>');
    expect(rows.find(i => i.id === 'skill:s').action.screen).toBe('SkillsScreen')
  });
  it('matches words across names and categories, no command execution', () => {
    const rows = buildJumpCatalog({
      sections: ALL_SECTIONS,
      agents: [{
        id: 'r',
        name: 'Research'
      }],
      query: 'research automation'
    }).flatMap(g => g.items);
    expect(rows.map(i => i.id)).toEqual(['agent:r']);
    expect(buildJumpCatalog({
      sections: ALL_SECTIONS
    }).flatMap(g => g.items).some(i => i.id.startsWith('do:'))).toBe(false)
  });
});
