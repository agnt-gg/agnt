// Skills catalog compaction — the Tier-1 catalog ships one gist line per
// skill instead of the full trigger blurb. At ~100 skills the old XML+full
// description format cost >13k tokens of EVERY system prompt; the gist keeps
// just enough trigger signal (activate_skill returns the full playbook).
import { describe, it, expect, vi } from 'vitest';

vi.mock('../models/SkillModel.js', () => ({ default: {} }));
vi.mock('../models/database/index.js', () => ({ default: {} }));
vi.mock('../utils/skillValidation.js', () => ({
  parseSkillMd: vi.fn(),
  serializeSkillMd: vi.fn(),
  isValidSkillName: vi.fn(),
  toKebabCase: vi.fn(),
}));

import { buildSkillCatalog, buildSkillActivationInstructions } from './SkillService.js';
import { skillCatalogGist } from '../utils/skillCatalogGist.js';

describe('skillCatalogGist', () => {
  it('keeps the first sentence of a long trigger blurb', () => {
    const desc =
      'Build, maintain, and query compiled LLM wikis with scope-aware fallback. ' +
      'Use whenever the user asks to create a knowledge base, ingest sources, or lint a wiki. ' +
      'Also trigger on "agent wiki", "llms.txt", and similar phrases.';
    expect(skillCatalogGist(desc)).toBe(
      'Build, maintain, and query compiled LLM wikis with scope-aware fallback.'
    );
  });

  it('does not truncate at an early "e.g." style period', () => {
    const desc =
      'Convert videos, e.g. MKV to MP4 files, quickly and correctly for the user. Second sentence with more detail here.';
    expect(skillCatalogGist(desc)).toBe(
      'Convert videos, e.g. MKV to MP4 files, quickly and correctly for the user.'
    );
  });

  it('caps a single run-on sentence at a word boundary', () => {
    const desc = ('alpha bravo charlie delta echo foxtrot golf hotel ').repeat(20).trim();
    const gist = skillCatalogGist(desc);
    expect(gist.length).toBeLessThanOrEqual(223);
    expect(gist.endsWith('...')).toBe(true);
    // Word-boundary cut: the char before the ellipsis is not a space and the
    // gist minus ellipsis is a prefix of the source.
    expect(desc.startsWith(gist.slice(0, -3))).toBe(true);
  });

  it('collapses internal whitespace and newlines', () => {
    const gist = skillCatalogGist('Line one\n  continues   here. More.');
    expect(gist).not.toMatch(/\n/);
    expect(gist).toBe('Line one continues here. More.');
  });

  it('handles empty / missing descriptions', () => {
    expect(skillCatalogGist('')).toBe('');
    expect(skillCatalogGist(null)).toBe('');
    expect(skillCatalogGist(undefined)).toBe('');
  });
});

describe('buildSkillCatalog (compact format)', () => {
  const longDesc =
    'Do the primary thing this skill exists for, described in one sentence. ' +
    'Use this skill whenever the user asks about X, Y, or Z, mentions A or B, or wants C. ' +
    'Also trigger when the user says D, E, F, G, H, or references I and J. '.repeat(4);

  it('emits one gist line per skill inside the available-skills wrapper', () => {
    const catalog = buildSkillCatalog([
      { name: 'skill-one', description: longDesc, source: 'filesystem' },
      { name: 'skill-two', description: 'Short and sweet purpose statement for skill two.', source: 'database' },
    ]);
    expect(catalog.startsWith('<available-skills>')).toBe(true);
    expect(catalog.endsWith('</available-skills>')).toBe(true);
    expect(catalog).toContain('- skill-one: Do the primary thing this skill exists for, described in one sentence.');
    expect(catalog).toContain('- skill-two: Short and sweet purpose statement for skill two.');
    // Old XML entry format is gone.
    expect(catalog).not.toContain('<skill name=');
    expect(catalog).not.toContain('<description>');
  });

  it('compresses a realistic 98-skill catalog by an order of magnitude', () => {
    const skills = Array.from({ length: 98 }, (_, i) => ({
      name: `skill-${i}`,
      description: longDesc,
      source: 'filesystem',
    }));
    const catalog = buildSkillCatalog(skills);
    const rawChars = skills.reduce((acc, s) => acc + s.description.length, 0);
    expect(catalog.length).toBeLessThan(rawChars / 4);
    expect(catalog.length).toBeLessThan(30000);
  });

  it('returns empty string for no skills', () => {
    expect(buildSkillCatalog([])).toBe('');
    expect(buildSkillCatalog(null)).toBe('');
  });
});

describe('buildSkillActivationInstructions', () => {
  it('tells the model the catalog lines are gists and activation is cheap', () => {
    const text = buildSkillActivationInstructions();
    expect(text).toContain('activate_skill');
    expect(text).toContain('gist');
  });
});
