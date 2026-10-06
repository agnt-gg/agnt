import { describe, it, expect } from 'vitest';
import { buildSkillCatalog, searchSkills, normalizeSkillKey } from './SkillService.js';

const skill = (name, description = `${name} does a specific job well. More detail follows here.`) => ({ name, description });
const SKILLS = [
  skill('frontend-design', 'Create distinctive, production-grade frontend interfaces. Long tail of triggers.'),
  skill('webgpu-threejs-tsl', 'Guide for WebGPU Three.js apps using TSL.'),
  skill('WebGPU Three.js TSL', 'Guide for WebGPU Three.js apps using TSL.'), // DB copy of the same skill
  skill('pdf-research-corpus-analyzer', 'Download and cross-reference folders of PDF research papers.'),
  skill('cast-to-tv', 'Cast local video to a TV or Chromecast.'),
  skill('plugin-a/research-method', 'Plugin A research method.'),
  skill('plugin-b/research-method', 'Plugin B research method.'),
];

describe('buildSkillCatalog', () => {
  it('without usage data lists every skill with its gist, as before', () => {
    const catalog = buildSkillCatalog(SKILLS);
    expect(catalog).toContain('- cast-to-tv: Cast local video to a TV or Chromecast.');
    expect(catalog).not.toContain('Also installed');
  });

  it('drops a skill installed twice under two spellings', () => {
    const catalog = buildSkillCatalog(SKILLS);
    expect(catalog).toContain('- webgpu-threejs-tsl:');
    expect(catalog).not.toContain('WebGPU Three.js TSL');
  });

  it('keeps same-named skills from different plugins apart', () => {
    const catalog = buildSkillCatalog(SKILLS);
    expect(catalog).toContain('plugin-a/research-method');
    expect(catalog).toContain('plugin-b/research-method');
  });

  it('with usage data: featured skills keep a gist, the rest are named, none disappear', () => {
    const featured = new Set(['frontend-design', 'WebGPU Three.js TSL'].map(normalizeSkillKey));
    const catalog = buildSkillCatalog(SKILLS, { featured });
    expect(catalog).toContain('- frontend-design: Create distinctive');
    expect(catalog).toContain('- webgpu-threejs-tsl: Guide'); // featured under either spelling
    expect(catalog).not.toContain('- cast-to-tv:');
    expect(catalog).toMatch(/Also installed[^\n]*cast-to-tv/);
    for (const s of ['pdf-research-corpus-analyzer', 'plugin-a/research-method', 'plugin-b/research-method']) expect(catalog).toContain(s);
    expect(catalog.length).toBeLessThan(buildSkillCatalog(SKILLS).length);
  });
});

describe('searchSkills', () => {
  it('finds a name-only skill from a description of the task', () => {
    expect(searchSkills(SKILLS, 'analyze a folder of PDF papers')[0].name).toBe('pdf-research-corpus-analyzer');
    expect(searchSkills(SKILLS, 'chromecast my video')[0]).toEqual({ name: 'cast-to-tv', gist: 'Cast local video to a TV or Chromecast.' });
  });

  it('returns nothing for an empty or stop-word query rather than everything', () => {
    expect(searchSkills(SKILLS, '')).toEqual([]);
    expect(searchSkills(SKILLS, 'a to of')).toEqual([]);
  });
});
